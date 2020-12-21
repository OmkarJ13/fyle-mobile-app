import { Component, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PopoverController, ToastController } from '@ionic/angular';
import { isNumber } from 'lodash';
import * as moment from 'moment';
import { forkJoin, from, iif, noop, Observable, of } from 'rxjs';
import { catchError, concatMap, finalize, map, switchMap, tap } from 'rxjs/operators';
import { CategoriesService } from 'src/app/core/services/categories.service';
import { DateService } from 'src/app/core/services/date.service';
import { FileService } from 'src/app/core/services/file.service';
import { OfflineService } from 'src/app/core/services/offline.service';
import { TransactionService } from 'src/app/core/services/transaction.service';
import { SplitExpenseService } from 'src/app/core/services/split-expense.service';
import { SplitExpenseStatusComponent } from './split-expense-status/split-expense-status.component';

@Component({
  selector: 'app-split-expense',
  templateUrl: './split-expense.page.html',
  styleUrls: ['./split-expense.page.scss'],
})
export class SplitExpensePage implements OnInit {

  splitExpensesFormArray = new FormArray([]);
  fg: FormGroup;
  splitType: string;
  amount: number;
  currency: string;
  totalSplitAmount: number;
  remainingAmount: number;
  categories$: Observable<any>;
  costCenters$: Observable<any>;
  transaction: any;
  fileObjs: any[];
  fileUrls: any[];
  maxDate: string;
  minDate: string;

  constructor(
    private activatedRoute: ActivatedRoute,
    private formBuilder: FormBuilder,
    private offlineService: OfflineService,
    private categoriesService: CategoriesService,
    private dateService: DateService,
    private toastController: ToastController,
    private splitExpenseService: SplitExpenseService,
    private popoverController: PopoverController,
    private transactionService: TransactionService,
    private fileService: FileService,
    private router: Router
  ) { }

  ngOnInit() {
  }

  goBack() {
    if (this.transaction.id) {
      this.router.navigate(['/', 'enterprise', 'add_edit_expense', { id: this.transaction.id }]);
    } else {
      this.router.navigate(['/', 'enterprise', 'add_edit_expense']);
    }
  }

  onChangeAmount(splitExpenseForm) {
    if (!splitExpenseForm.controls.amount._pendingChange || (!this.amount || !isNumber(splitExpenseForm.value.amount))) {
      return;
    }

    let percentage = (splitExpenseForm.value.amount / this.amount ) * 100;
    percentage = parseFloat(percentage.toFixed(3));

    splitExpenseForm.patchValue({
      percentage
    });

    this.getTotalSplitAmount();
  }

  onChangePercentage(splitExpenseForm){
    if (!splitExpenseForm.controls.percentage._pendingChange || (!this.amount || !isNumber(splitExpenseForm.value.percentage))) {
      return;
    }

    let amount = (this.amount * splitExpenseForm.value.percentage) / 100;
    amount = parseFloat(amount.toFixed(3));

    splitExpenseForm.patchValue({
      amount
    });
    this.getTotalSplitAmount();
  }

  getTotalSplitAmount() {
    if (this.splitExpensesFormArray.value.length > 1) {

      const amounts = this.splitExpensesFormArray.value.map(obj => obj.amount);

      const totalSplitAmount = amounts.reduce((acc, curr) => {
        return acc + curr;
      });

      this.totalSplitAmount = parseFloat(totalSplitAmount.toFixed(3)) || 0;
      const remainingAmount = this.amount - this.totalSplitAmount;
      this.remainingAmount = parseFloat(remainingAmount.toFixed(3)) || 0;
    }
  }

  generateSplitEtxnFromFg(splitExpenseValue) {
    return {
        ...this.transaction,
        org_category_id: splitExpenseValue.category && splitExpenseValue.category.id,
        project_id: splitExpenseValue.project && splitExpenseValue.project.project_id,
        cost_center_id: splitExpenseValue.cost_center && splitExpenseValue.cost_center.id,
        currency: splitExpenseValue.currency,
        amount: splitExpenseValue.amount,
        source: 'MOBILE'
    }
  }

  uploadFiles(files) {
    if (!this.transaction.id) {
      return of(null);
    } else {
      return this.getAttachedFiles(this.transaction.id);
    }
  }

  createAndLinkTxnsWithFiles(splitExpenses) {
    console.log(splitExpenses);
    const splitExpense$: any = {
      txns: this.splitExpenseService.createSplitTxns(this.transaction, this.totalSplitAmount, splitExpenses)
    };

    if (this.fileObjs && this.fileObjs.length > 0) {
      splitExpense$.files = this.splitExpenseService.getBase64Content(this.fileObjs);
    }

    return forkJoin(splitExpense$).pipe(
      // switchMap(data => {
      //   return this.splitExpenseService.linkTxnWithFiles(data);
      // }),
      switchMap((data: any) => {
        const txnIds = data.txns.map((txn) => {
          return txn.id;
        });
        console.log(txnIds);
        return this.splitExpenseService.linkTxnWithFiles(data).pipe(
          map(() => {
            return txnIds;
          })
        )
        //return txnIds;
      })
    )

  }

  async showSplitExpenseStatusPopup(isSplitSuccessful: boolean) {
    //return of(null);
    const splitExpenseStatusPopup = await this.popoverController.create({
      component: SplitExpenseStatusComponent,
      componentProps: {
        isSplitSuccessful
      },
      //cssClass: 'error-popover'
    });

    await splitExpenseStatusPopup.present();
  }

  getAttachedFiles(transactionId) {
    return this.fileService.findByTransactionId(transactionId).pipe(
      map(uploadedFiles => {
        this.fileObjs = uploadedFiles;
        return this.fileObjs;
      })
    );
  }

  save() {
    if (this.splitExpensesFormArray.valid) {
      if (this.amount && this.amount > 0 && this.amount !== this.totalSplitAmount ) {
        // Todo: show Error block
      }
      const generatedSplitEtxn = [];
      this.splitExpensesFormArray.value.forEach(splitExpenseValue => {
        generatedSplitEtxn.push(this.generateSplitEtxnFromFg(splitExpenseValue));
      });

      const uploadFiles$ = this.uploadFiles(this.fileUrls);

      uploadFiles$.pipe(
        concatMap(() => {
          return this.createAndLinkTxnsWithFiles(generatedSplitEtxn);
        }),
        concatMap(() => {
          return iif(
            () => this.transaction.id,
            this.transactionService.delete(this.transaction.id),
            of(null));
        }),
      ).subscribe(
        () => this.showSplitExpenseStatusPopup(true),
        () => this.showSplitExpenseStatusPopup(false)
      );

    } else {
      this.splitExpensesFormArray.markAllAsTouched();
    }
  }

  getActiveCategories() {
    const allCategories$ = this.offlineService.getAllCategories();

    return allCategories$.pipe(
      map(catogories => {
        return catogories.filter(category => {
          return category.enabled === true;
        });
      }),
      map(catogories => {
        return this.categoriesService.filterRequired(catogories);
      })
    );
  }

  ionViewWillEnter() {
    this.offlineService.getHomeCurrency().subscribe(homeCurrency => {
      const currencyObj = JSON.parse(this.activatedRoute.snapshot.params.currencyObj);
      this.splitType = this.activatedRoute.snapshot.params.splitType;
      this.transaction = JSON.parse(this.activatedRoute.snapshot.params.txn);
      this.fileUrls = this.activatedRoute.snapshot.params.fileObjs;

      if (this.splitType === 'categories') {
        this.categories$ = this.getActiveCategories().pipe(
          map(categories => {
            return categories.map(category => {
              return { label: category.displayName, value: category };
            });
          })
        );
      } else if (this.splitType === 'cost centers') {
        const orgSettings$ = this.offlineService.getOrgSettings();
        const orgUserSettings$ = this.offlineService.getOrgUserSettings();
        this.costCenters$ = forkJoin({
          orgSettings: orgSettings$,
          orgUserSettings: orgUserSettings$
        }).pipe(
          switchMap(({ orgSettings, orgUserSettings }) => {
            if (orgSettings.cost_centers.enabled) {
              return this.offlineService.getAllowedCostCenters(orgUserSettings);
            } else {
              return of([]);
            }
          }),
          map(costCenters => {
            return costCenters.map(costCenter => ({
              label: costCenter.name,
              value: costCenter
            }));
          })
        );
      }

      this.amount = currencyObj && (currencyObj.orig_amount || currencyObj.amount);
      this.currency = (currencyObj && (currencyObj.orig_currency || currencyObj.currency)) || homeCurrency;

      let amount1 = this.amount > 0.0001 ? this.amount * 0.6 : null; // 60% split
      let amount2 = this.amount > 0.0001 ? this.amount * 0.4 : null; //40% split
      const percentage1 = this.amount ? 60 : null;
      const percentage2 = this.amount ? 40 : null;
      amount1 = amount1 ? parseFloat(amount1.toFixed(3)) : amount1;
      amount2 = amount2 ? parseFloat(amount2.toFixed(3)) : amount2;
      this.add(amount1, this.currency, percentage1, null);
      this.add(amount2, this.currency, percentage2, null);
      this.getTotalSplitAmount();

      const today = new Date();
      const minDate = new Date('Jan 1, 2001');
      const maxDate = this.dateService.addDaysToDate(today, 1);

      this.minDate = minDate.getFullYear() + '-' + (minDate.getMonth() + 1) + '-' + minDate.getDate();
      this.maxDate = maxDate.getFullYear() + '-' + (maxDate.getMonth() + 1) + '-' + maxDate.getDate();

    });

  }

  add(amount?, currency?, percentage?, txnDt?) {
    if (!txnDt) {
      const dateOfTxn = this.transaction?.txn_dt;
      const today: any = new Date();
      txnDt = dateOfTxn ? new Date(dateOfTxn) : today;
      txnDt = moment(txnDt).format('yyyy-MM-DD');
    }
    const fg = this.formBuilder.group({
      amount: [amount, Validators.required],
      currency: [currency, ],
      percentage: [percentage, ],
      txn_dt: [txnDt, Validators.required]
    });

    if (this.splitType === 'categories') {
      fg.addControl('category', this.formBuilder.control('', [Validators.required]));
    } else if (this.splitType === 'projects') {
      fg.addControl('project', this.formBuilder.control('', [Validators.required]));
    } else if (this.splitType === 'cost centers') {
      fg.addControl('cost_center', this.formBuilder.control('', [Validators.required]));
    }

    this.splitExpensesFormArray.push(fg);
    this.getTotalSplitAmount();
  }

  remove(index: number) {
    this.splitExpensesFormArray.removeAt(index);
    this.getTotalSplitAmount();
  }




}
