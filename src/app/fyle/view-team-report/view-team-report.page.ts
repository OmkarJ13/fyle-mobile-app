import { Component, OnInit } from '@angular/core';
import { Observable, from, noop, Subject } from 'rxjs';
import { ExtendedReport } from 'src/app/core/models/report.model';
import { ExtendedTripRequest } from 'src/app/core/models/extended_trip_request.model';
import { ActivatedRoute, Router } from '@angular/router';
import { ReportService } from 'src/app/core/services/report.service';
import { TransactionService } from 'src/app/core/services/transaction.service';
import { AuthService } from 'src/app/core/services/auth.service';
import { LoaderService } from 'src/app/core/services/loader.service';
import { PopoverController } from '@ionic/angular';
import { switchMap, finalize, map, shareReplay, tap, startWith } from 'rxjs/operators';
import { ShareReportComponent } from './share-report/share-report.component';
import { PopupService } from 'src/app/core/services/popup.service';
import { SendBackComponent } from './send-back/send-back.component';
import { ApproveReportComponent } from './approve-report/approve-report.component';

@Component({
  selector: 'app-view-team-report',
  templateUrl: './view-team-report.page.html',
  styleUrls: ['./view-team-report.page.scss'],
})
export class ViewTeamReportPage implements OnInit {

  erpt$: Observable<ExtendedReport>;
  etxns$: Observable<any[]>;
  sharedWith$: Observable<any[]>;
  reportApprovals$: Observable<any>;
  refreshApprovals$ = new Subject();
  tripRequest$: Observable<ExtendedTripRequest>;
  hideAllExpenses = true;
  sharedWithLimit = 3;

  canEdit$: Observable<boolean>;
  canDelete$: Observable<boolean>;
  canResubmitReport$: Observable<boolean>;
  isReportReported: boolean;

  constructor(
    private activatedRoute: ActivatedRoute,
    private reportService: ReportService,
    private transactionService: TransactionService,
    private authService: AuthService,
    private loaderService: LoaderService,
    private router: Router,
    private popoverController: PopoverController,
    private popupService: PopupService
  ) { }

  ngOnInit() {
  }

  getVendorName(etxn) {
    const category = etxn.tx_org_category && etxn.tx_org_category.toLowerCase();
    let vendorName = etxn.tx_vendor || 'Expense';

    if (category === 'mileage') {
      vendorName = etxn.tx_distance;
      vendorName += ' ' + etxn.tx_distance_unit;
    } else if (category === 'per diem') {
      vendorName = etxn.tx_num_days;
      vendorName += ' Days';
    }

    return vendorName;
  }

  getApproverEmails(reportApprovals) {
    return reportApprovals.map(approver => {
      return approver.approver_email;
    });
  }

  getShowViolation(etxn) {
    return etxn.tx_id &&
      (etxn.tx_manual_flag ||
        etxn.tx_policy_flag) &&
      !((typeof (etxn.tx_policy_amount) === 'number')
        && etxn.tx_policy_amount < 0.0001);
  }

  ionViewWillEnter() {
    this.erpt$ = this.refreshApprovals$.pipe(
      switchMap(() => {
        return from(this.loaderService.showLoader()).pipe(
          switchMap(() => {
            return this.reportService.getTeamReport(this.activatedRoute.snapshot.params.id);
          })
        );
      }),
      shareReplay(),
      finalize(() => from(this.loaderService.hideLoader()))
    );

    this.erpt$.subscribe(res => {
      this.isReportReported = ['APPROVER_PENDING'].indexOf(res.rp_state) > -1;
    });

    this.sharedWith$ = this.reportService.getExports(this.activatedRoute.snapshot.params.id).pipe(
      map(pdfExports => {
        return pdfExports.results.sort((a, b) => {
          return (a.created_at < b.created_at) ? 1 : ((b.created_at < a.created_at) ? -1 : 0);
        }).map((pdfExport) => {
          return pdfExport.sent_to;
        }).filter((item, index, inputArray) => {
          return inputArray.indexOf(item) === index;
        });
      })
    );

    this.reportApprovals$ = this.refreshApprovals$.pipe(
      startWith(true),
      switchMap(() => {
        return this.reportService.getApproversByReportId(this.activatedRoute.snapshot.params.id)
      }),
      map(reportApprovals => {
        return reportApprovals.filter((approval) => {
          return ['APPROVAL_PENDING', 'APPROVAL_DONE'].indexOf(approval.state) > -1;
        }).map((approval) => {
          if (approval && approval.state === 'APPROVAL_DONE' && approval.updated_at) {
            approval.approved_at = approval.updated_at;
          }
          return approval;
        });
      })
    );

    this.etxns$ = from(this.authService.getEou()).pipe(
      switchMap(eou => {
        return this.transactionService.getAllETxnc({
          tx_report_id: 'eq.' + this.activatedRoute.snapshot.params.id,
          order: 'tx_txn_dt.desc,tx_id.desc'
        });
      }),
      map(
        etxns => etxns.map(etxn => {
          etxn.vendor = this.getVendorName(etxn);
          etxn.violation = this.getShowViolation(etxn);
          return etxn;
        })
      ),
      shareReplay()
    );

    const actions$ = this.reportService.actions(this.activatedRoute.snapshot.params.id).pipe(shareReplay());

    this.canEdit$ = actions$.pipe(map(actions => actions.can_edit));
    this.canDelete$ = actions$.pipe(map(actions => actions.can_delete));
    this.canResubmitReport$ = actions$.pipe(map(actions => actions.can_resubmit));

    this.etxns$.subscribe(noop);

    this.refreshApprovals$.next();
  }

  async deleteReport() {
    const popupResult = await this.popupService.showPopup({
      header: 'Delete Report',
      message: `
        <p class="highlight-info">
          On deleting this report, all the associated expenses will be moved to <strong>My Expenses</strong> list.
        </p>
        <p>
          Are you sure, you want to delete this report?
        </p>
      `,
      primaryCta: {
        text: 'Delete Report'
      }
    });

    if (popupResult === 'primary') {
      from(this.loaderService.showLoader()).pipe(
        switchMap(() => {
          return this.reportService.delete(this.activatedRoute.snapshot.params.id);
        }),
        finalize(() => from(this.loaderService.hideLoader()))
      ).subscribe(() => {
        this.router.navigate(['/', 'enterprise', 'team_reports']);
      });
    }
  }

  async approveReport() {
    const erpt = await this.erpt$.toPromise();
    const etxns = await this.etxns$.toPromise();

    const popover = await this.popoverController.create({
      componentProps: {
        erpt,
        etxns
      },
      component: ApproveReportComponent,
      cssClass: 'dialog-popover'
    });

    await popover.present();

    const { data } = await popover.onWillDismiss();

    if (data.goBack) {
      this.router.navigate(['/', 'enterprise', 'team_reports']);
    }
  }

  onUpdateApprover(message: string) {
    if (message) {
      this.refreshApprovals$.next();
    }
  }

  goToTransaction(etxn: any) {
    let category;

    if (etxn.tx_org_category) {
      category = etxn.tx_org_category.toLowerCase();
    }

    if (category === 'activity') {
      return this.popupService.showPopup({
        header: 'Cannot Edit Activity',
        message: 'Editing activity is not supported in mobile app.',
        primaryCta: {
          text: 'Cancel'
        }
      });
    }

    let route;

    if (category === 'mileage') {
      route = '/enterprise/view_team_mileage';
    } else if (category === 'per diem') {
      route = '/enterprise/view_team_per_diem';
    } else {
      route = '/enterprise/view_team_expense';
    }

    // TODO: also need to send scroll position
    this.router.navigate([route, { id: etxn.tx_id }]);
  }

  async shareReport(event) {
    const popover = await this.popoverController.create({
      component: ShareReportComponent,
      cssClass: 'dialog-popover'
    });

    await popover.present();

    const { data } = await popover.onWillDismiss();

    if (data.email) {
      const params = {
        report_ids: [this.activatedRoute.snapshot.params.id],
        email: data.email
      };
      this.reportService.downloadSummaryPdfUrl(params).subscribe(async () => {
        const message = `We will send ${data.email} a link to download the PDF <br> when it is generated and send you a copy.`;
        await this.loaderService.showLoader(message);
      });
    }
  }

  async sendBack() {
    const erpt = await this.erpt$.toPromise();
    const etxns = await this.etxns$.toPromise();

    const popover = await this.popoverController.create({
      componentProps: {
        erpt,
        etxns
      },
      component: SendBackComponent,
      cssClass: 'dialog-popover'
    });

    await popover.present();

    const { data } = await popover.onWillDismiss();

    if (data.goBack) {
      this.router.navigate(['/', 'enterprise', 'team_reports']);
    }
  }
}
