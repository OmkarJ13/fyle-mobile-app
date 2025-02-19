import { Component, ElementRef, EventEmitter, OnInit, ViewChild } from '@angular/core';
import { Observable, from, Subject, concat, forkJoin, BehaviorSubject } from 'rxjs';
import { ExtendedReport } from 'src/app/core/models/report.model';
import { ActivatedRoute, Router } from '@angular/router';
import { ReportService } from 'src/app/core/services/report.service';
import { AuthService } from 'src/app/core/services/auth.service';
import { LoaderService } from 'src/app/core/services/loader.service';
import { PopoverController, ModalController, IonContent } from '@ionic/angular';
import { ModalPropertiesService } from 'src/app/core/services/modal-properties.service';
import { switchMap, finalize, map, shareReplay, tap, startWith, take, takeUntil, filter } from 'rxjs/operators';
import { ShareReportComponent } from './share-report/share-report.component';
import { PopupService } from 'src/app/core/services/popup.service';
import { NetworkService } from '../../core/services/network.service';
import { FyViewReportInfoComponent } from 'src/app/shared/components/fy-view-report-info/fy-view-report-info.component';
import { TrackingService } from '../../core/services/tracking.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ToastMessageComponent } from 'src/app/shared/components/toast-message/toast-message.component';
import { SnackbarPropertiesService } from 'src/app/core/services/snackbar-properties.service';
import { FyPopoverComponent } from 'src/app/shared/components/fy-popover/fy-popover.component';
import { RefinerService } from 'src/app/core/services/refiner.service';
import { Expense } from 'src/app/core/models/expense.model';
import { ExpenseView } from 'src/app/core/models/expense-view.enum';
import { getCurrencySymbol } from '@angular/common';
import * as dayjs from 'dayjs';
import { StatusService } from 'src/app/core/services/status.service';
import { ExtendedStatus } from 'src/app/core/models/extended_status.model';
import { PopupAlertComponent } from 'src/app/shared/components/popup-alert/popup-alert.component';
import { HumanizeCurrencyPipe } from 'src/app/shared/pipes/humanize-currency.pipe';
import { ExtendedOrgUser } from 'src/app/core/models/extended-org-user.model';
import { Approver } from 'src/app/core/models/v1/approver.model';
import { OrgSettingsService } from 'src/app/core/services/org-settings.service';
import { PdfExport } from 'src/app/core/models/pdf-exports.model';
import { EditReportNamePopoverComponent } from '../my-view-report/edit-report-name-popover/edit-report-name-popover.component';
@Component({
  selector: 'app-view-team-report',
  templateUrl: './view-team-report.page.html',
  styleUrls: ['./view-team-report.page.scss'],
})
export class ViewTeamReportPage implements OnInit {
  @ViewChild('commentInput') commentInput: ElementRef;

  @ViewChild(IonContent, { static: false }) content: IonContent;

  erpt$: Observable<ExtendedReport>;

  etxns$: Observable<Expense[]>;

  sharedWith$: Observable<any[]>;

  reportApprovals$: Observable<any>;

  refreshApprovals$ = new Subject();

  actions$: Observable<any>;

  hideAllExpenses = true;

  sharedWithLimit = 3;

  canEdit$: Observable<boolean>;

  canDelete$: Observable<boolean>;

  canResubmitReport$: Observable<boolean>;

  isReportReported: boolean;

  isConnected$: Observable<boolean>;

  onPageExit = new Subject();

  reportCurrencySymbol = '';

  reportName: string;

  navigateBack = false;

  isCommentsView = false;

  isHistoryView = false;

  isExpensesView = true;

  estatuses$: Observable<ExtendedStatus[]>;

  refreshEstatuses$: Subject<void> = new Subject();

  systemComments: ExtendedStatus[];

  type: string;

  systemEstatuses: ExtendedStatus[];

  userComments: any;

  totalCommentsCount$: Observable<number>;

  newComment: string;

  objectType = 'reports';

  objectId = this.activatedRoute.snapshot.params.id;

  isCommentAdded: boolean;

  etxnAmountSum$: Observable<any>;

  reportEtxnIds: string[];

  isExpensesLoading: boolean;

  isSequentialApprovalEnabled = false;

  canApprove = true;

  eou$: Observable<ExtendedOrgUser>;

  canShowTooltip = false;

  simplifyReportsSettings$: Observable<{ enabled: boolean }>;

  loadReportDetails$ = new BehaviorSubject<void>(null);

  eou: ExtendedOrgUser;

  reportNameChangeStartTime: number;

  reportNameChangeEndTime: number;

  timeSpentOnEditingReportName: number;

  constructor(
    private activatedRoute: ActivatedRoute,
    private reportService: ReportService,
    private authService: AuthService,
    private loaderService: LoaderService,
    private router: Router,
    private popoverController: PopoverController,
    private popupService: PopupService,
    private networkService: NetworkService,
    private modalController: ModalController,
    private modalProperties: ModalPropertiesService,
    private trackingService: TrackingService,
    private matSnackBar: MatSnackBar,
    private snackbarProperties: SnackbarPropertiesService,
    private refinerService: RefinerService,
    private statusService: StatusService,
    private humanizeCurrency: HumanizeCurrencyPipe,
    private orgSettingsService: OrgSettingsService
  ) {}

  ngOnInit() {}

  ionViewWillLeave() {
    this.onPageExit.next(null);
  }

  setupNetworkWatcher() {
    const networkWatcherEmitter = new EventEmitter<boolean>();
    this.networkService.connectivityWatcher(networkWatcherEmitter);
    this.isConnected$ = concat(this.networkService.isOnline(), networkWatcherEmitter.asObservable()).pipe(
      takeUntil(this.onPageExit),
      shareReplay(1)
    );

    this.isConnected$.subscribe((isOnline) => {
      if (!isOnline) {
        this.router.navigate(['/', 'enterprise', 'my_dashboard']);
      }
    });
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
    return reportApprovals.map((approver) => approver.approver_email);
  }

  getShowViolation(etxn) {
    return (
      etxn.tx_id &&
      (etxn.tx_manual_flag || etxn.tx_policy_flag) &&
      !(typeof etxn.tx_policy_amount === 'number' && etxn.tx_policy_amount < 0.0001)
    );
  }

  loadReports(): Observable<ExtendedReport> {
    return this.loadReportDetails$.pipe(
      tap(() => this.loaderService.showLoader()),
      switchMap(() =>
        this.reportService
          .getReport(this.activatedRoute.snapshot.params.id)
          .pipe(finalize(() => this.loaderService.hideLoader()))
      ),
      shareReplay(1)
    );
  }

  getApprovalSettings(orgSettings) {
    return orgSettings?.approval_settings?.enable_sequential_approvers;
  }

  getReportClosureSettings(orgSettings) {
    return orgSettings?.simplified_report_closure_settings?.enabled;
  }

  ionViewWillEnter() {
    this.isExpensesLoading = true;
    this.setupNetworkWatcher();

    this.navigateBack = this.activatedRoute.snapshot.params.navigate_back;

    this.erpt$ = this.loadReports();
    this.eou$ = from(this.authService.getEou());

    this.eou$.subscribe((eou) => (this.eou = eou));

    this.estatuses$ = this.refreshEstatuses$.pipe(
      startWith(0),
      switchMap(() => this.eou$),
      switchMap((eou) =>
        this.statusService.find(this.objectType, this.objectId).pipe(
          map((estatus) =>
            estatus.map((status) => {
              status.isBotComment = status && ['SYSTEM', 'POLICY'].indexOf(status.st_org_user_id) > -1;
              status.isSelfComment = status && eou && eou.ou && status.st_org_user_id === eou.ou.id;
              status.isOthersComment = status && eou && eou.ou && status.st_org_user_id !== eou.ou.id;
              return status;
            })
          ),
          map((res) => res.sort((a, b) => a.st_created_at.valueOf() - b.st_created_at.valueOf()))
        )
      )
    );

    const orgSettings$ = this.orgSettingsService.get();
    this.simplifyReportsSettings$ = orgSettings$.pipe(
      map((orgSettings) => ({ enabled: this.getReportClosureSettings(orgSettings) }))
    );

    this.estatuses$.subscribe((estatuses) => {
      const reversalStatus = estatuses.filter(
        (status) => status.st_comment.indexOf('created') > -1 && status.st_comment.indexOf('reversal') > -1
      );

      this.systemComments = estatuses.filter((status) => ['SYSTEM', 'POLICY'].indexOf(status.st_org_user_id) > -1);

      this.type =
        this.objectType.toLowerCase() === 'transactions'
          ? 'Expense'
          : this.objectType.substring(0, this.objectType.length - 1);

      this.systemEstatuses = this.statusService.createStatusMap(this.systemComments, this.type);

      this.userComments = estatuses.filter((status) => status.us_full_name);

      for (let i = 0; i < this.userComments.length; i++) {
        const prevCommentDt = dayjs(this.userComments[i - 1] && this.userComments[i - 1].st_created_at);
        const currentCommentDt = dayjs(this.userComments[i] && this.userComments[i].st_created_at);
        if (dayjs(prevCommentDt).isSame(currentCommentDt, 'day')) {
          this.userComments[i].show_dt = false;
        } else {
          this.userComments[i].show_dt = true;
        }
      }
    });

    this.totalCommentsCount$ = this.estatuses$.pipe(
      map((res) => res.filter((estatus) => estatus.st_org_user_id !== 'SYSTEM').length)
    );

    this.erpt$ = this.refreshApprovals$.pipe(
      switchMap(() =>
        from(this.loaderService.showLoader()).pipe(
          switchMap(() => this.reportService.getTeamReport(this.activatedRoute.snapshot.params.id))
        )
      ),
      shareReplay(1),
      finalize(() => from(this.loaderService.hideLoader()))
    );

    this.erpt$.pipe(filter((erpt) => !!erpt)).subscribe((erpt: ExtendedReport) => {
      this.reportCurrencySymbol = getCurrencySymbol(erpt.rp_currency, 'wide');
      this.reportName = erpt.rp_purpose;
      /**
       * if current user is remove from approver, erpt call will go again to fetch current report details
       * so checking if report details are available in erpt than continue execution
       * else redirect them to team reports
       */
      if (erpt) {
        this.isReportReported = ['APPROVER_PENDING'].indexOf(erpt.rp_state) > -1;
      }
    });

    this.sharedWith$ = this.reportService.getExports(this.activatedRoute.snapshot.params.id).pipe(
      map((pdfExports: { results: PdfExport[] }) =>
        pdfExports.results
          .sort((a, b) => (a.created_at < b.created_at ? 1 : b.created_at < a.created_at ? -1 : 0))
          .map((pdfExport) => pdfExport.sent_to)
          .filter((item, index, inputArray) => inputArray.indexOf(item) === index)
      )
    );

    this.reportApprovals$ = this.refreshApprovals$.pipe(
      startWith(true),
      switchMap(() => this.reportService.getApproversByReportId(this.activatedRoute.snapshot.params.id)),
      map((reportApprovals) =>
        reportApprovals
          .filter((approval) => ['APPROVAL_PENDING', 'APPROVAL_DONE'].indexOf(approval.state) > -1)
          .map((approval) => approval)
      )
    );

    this.etxns$ = from(this.authService.getEou()).pipe(
      switchMap((eou) => this.reportService.getReportETxnc(this.activatedRoute.snapshot.params.id, eou.ou.id)),
      map((etxns) =>
        etxns.map((etxn) => {
          etxn.vendor = this.getVendorName(etxn);
          etxn.violation = this.getShowViolation(etxn);
          return etxn;
        })
      ),
      shareReplay(1),
      finalize(() => (this.isExpensesLoading = false))
    );

    this.etxnAmountSum$ = this.etxns$.pipe(map((etxns) => etxns.reduce((acc, curr) => acc + curr.tx_amount, 0)));

    this.actions$ = this.reportService.actions(this.activatedRoute.snapshot.params.id).pipe(shareReplay(1));

    this.canEdit$ = this.actions$.pipe(map((actions) => actions.can_edit));
    this.canDelete$ = this.actions$.pipe(map((actions) => actions.can_delete));
    this.canResubmitReport$ = this.actions$.pipe(map((actions) => actions.can_resubmit));

    forkJoin({
      etxns: this.etxns$,
      eou: this.eou$,
      approvals: this.reportApprovals$.pipe(take(1)),
      orgSettings: this.orgSettingsService.get(),
    }).subscribe((res) => {
      this.reportEtxnIds = res.etxns.map((etxn) => etxn.tx_id);
      this.isSequentialApprovalEnabled = this.getApprovalSettings(res.orgSettings);
      this.canApprove = this.isSequentialApprovalEnabled
        ? this.isUserActiveInCurrentSeqApprovalQueue(res.eou, res.approvals)
        : true;
      this.canShowTooltip = true;
    });

    this.refreshApprovals$.next(null);
  }

  toggleTooltip() {
    this.canShowTooltip = !this.canShowTooltip;
  }

  isUserActiveInCurrentSeqApprovalQueue(eou: ExtendedOrgUser, approvers: Approver[]): boolean {
    const currentApproverRank = approvers.find((approver) => approver.approver_id === eou.ou.id)?.rank;

    const approverRanks = approvers
      .filter((approver) => approver.state === 'APPROVAL_PENDING')
      .map((approver) => approver.rank);

    if (approverRanks.length > 0) {
      const minRank = approverRanks.reduce((prev, curr) => (prev < curr ? prev : curr));
      return currentApproverRank === minRank;
    }

    return false;
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
        text: 'Delete Report',
      },
    });

    if (popupResult === 'primary') {
      from(this.loaderService.showLoader())
        .pipe(
          switchMap(() => this.reportService.delete(this.activatedRoute.snapshot.params.id)),
          finalize(() => from(this.loaderService.hideLoader()))
        )
        .subscribe(() => {
          this.router.navigate(['/', 'enterprise', 'team_reports']);
        });
    }
  }

  async approveReport() {
    if (!this.canApprove) {
      this.toggleTooltip();
    } else {
      const erpt = await this.erpt$.pipe(take(1)).toPromise();
      const etxns = await this.etxns$.toPromise();

      const rpAmount = this.humanizeCurrency.transform(erpt.rp_amount, erpt.rp_currency, false);
      const popover = await this.popoverController.create({
        componentProps: {
          etxns,
          title: 'Approve Report',
          message: erpt.rp_num_transactions + ' expenses of amount ' + rpAmount + ' will be approved',
          primaryCta: {
            text: 'Approve',
            action: 'approve',
          },
          secondaryCta: {
            text: 'Cancel',
            action: 'cancel',
          },
        },
        component: PopupAlertComponent,
        cssClass: 'pop-up-in-center',
      });

      await popover.present();

      const { data } = await popover.onWillDismiss();

      if (data && data.action === 'approve') {
        this.reportService.approve(erpt.rp_id).subscribe(() => {
          this.refinerService.startSurvey({ actionName: 'Approve Report' });
          this.router.navigate(['/', 'enterprise', 'team_reports']);
        });
      }
    }
  }

  onUpdateApprover(message: boolean) {
    if (message) {
      this.refreshApprovals$.next(null);
    }
  }

  goToTransaction({ etxn, etxnIndex }) {
    const category = etxn && etxn.tx_org_category && etxn.tx_org_category.toLowerCase();

    let route: string;
    if (category === 'mileage') {
      route = '/enterprise/view_mileage';
    } else if (category === 'per diem') {
      route = '/enterprise/view_per_diem';
    } else {
      route = '/enterprise/view_expense';
    }
    this.trackingService.viewExpenseClicked({ view: ExpenseView.team, category });
    this.router.navigate([
      route,
      { id: etxn.tx_id, txnIds: JSON.stringify(this.reportEtxnIds), activeIndex: etxnIndex, view: ExpenseView.team },
    ]);
  }

  async shareReport(event) {
    const popover = await this.popoverController.create({
      component: ShareReportComponent,
      cssClass: 'dialog-popover',
    });

    await popover.present();

    const { data } = await popover.onWillDismiss();

    if (data.email) {
      const params = {
        report_ids: [this.activatedRoute.snapshot.params.id],
        email: data.email,
      };
      this.reportService.downloadSummaryPdfUrl(params).subscribe(async () => {
        const message = `We will send ${data.email} a link to download the PDF <br> when it is generated and send you a copy.`;
        await this.loaderService.showLoader(message);
      });
    }
  }

  async sendBack() {
    const popover = await this.popoverController.create({
      component: FyPopoverComponent,
      componentProps: {
        title: 'Send Back',
        formLabel: 'Reason for sending back',
      },
      cssClass: 'fy-dialog-popover',
    });

    await popover.present();
    const { data } = await popover.onWillDismiss();

    if (data && data.comment) {
      const status = {
        comment: data.comment,
      };
      const statusPayload = {
        status,
        notify: false,
      };

      this.reportService.inquire(this.activatedRoute.snapshot.params.id, statusPayload).subscribe(() => {
        const message = 'Report Sent Back successfully';
        this.matSnackBar.openFromComponent(ToastMessageComponent, {
          ...this.snackbarProperties.setSnackbarProperties('success', { message }),
          panelClass: ['msb-success-with-camera-icon'],
        });
        this.trackingService.showToastMessage({ ToastContent: message });
        this.refinerService.startSurvey({ actionName: 'Send Back Report' });
      });
      this.router.navigate(['/', 'enterprise', 'team_reports']);
    }
  }

  async openViewReportInfoModal() {
    const viewInfoModal = await this.modalController.create({
      component: FyViewReportInfoComponent,
      componentProps: {
        erpt$: this.erpt$,
        etxns$: this.etxns$,
        view: ExpenseView.team,
      },
      ...this.modalProperties.getModalDefaultProperties(),
    });

    await viewInfoModal.present();
    await viewInfoModal.onWillDismiss();

    this.trackingService.clickViewReportInfo({ view: ExpenseView.team });
  }

  segmentChanged(event) {
    if (event && event.detail && event.detail.value) {
      if (event.detail.value === 'expenses') {
        this.isExpensesView = true;
        this.isCommentsView = false;
        this.isHistoryView = false;
      } else if (event.detail.value === 'comments') {
        this.isCommentsView = true;
        this.isExpensesView = false;
        this.isHistoryView = false;
        setTimeout(() => {
          this.content.scrollToBottom(500);
        }, 500);
      } else if (event.detail.value === 'history') {
        this.isHistoryView = true;
        this.isCommentsView = false;
        this.isExpensesView = false;
      }
    }
  }

  addComment() {
    if (this.newComment) {
      const data = {
        comment: this.newComment,
      };

      this.newComment = null;
      this.commentInput.nativeElement.focus();
      this.isCommentAdded = true;

      this.statusService.post(this.objectType, this.objectId, data).subscribe((res) => {
        this.refreshEstatuses$.next(null);
        setTimeout(() => {
          this.content.scrollToBottom(500);
        }, 500);
      });
    }
  }

  trackReportNameChange(): void {
    this.reportNameChangeEndTime = new Date().getTime();
    this.timeSpentOnEditingReportName = (this.reportNameChangeEndTime - this.reportNameChangeStartTime) / 1000;
    this.trackingService.reportNameChange({
      Time_spent: this.timeSpentOnEditingReportName,
      Roles: this.eou?.ou.roles,
    });
  }

  showReportNameChangeSuccessToast(): void {
    const message = 'Report name changed successfully.';
    this.matSnackBar.openFromComponent(ToastMessageComponent, {
      ...this.snackbarProperties.setSnackbarProperties('success', { message }),
      panelClass: ['msb-success'],
    });
    this.trackingService.showToastMessage({ ToastContent: message });
  }

  updateReportName(reportName: string): void {
    this.erpt$
      .pipe(
        take(1),
        switchMap((erpt) => {
          erpt.rp_purpose = reportName;
          return this.reportService.approverUpdateReportPurpose(erpt);
        })
      )
      .subscribe(() => {
        this.loadReportDetails$.next();
        this.showReportNameChangeSuccessToast();
        this.trackReportNameChange();
      });
  }

  editReportName(): void {
    this.reportNameChangeStartTime = new Date().getTime();
    this.erpt$
      .pipe(take(1))
      .pipe(
        switchMap((erpt) => {
          const editReportNamePopover = this.popoverController.create({
            component: EditReportNamePopoverComponent,
            componentProps: {
              reportName: erpt.rp_purpose,
            },
            cssClass: 'fy-dialog-popover',
          });
          return editReportNamePopover;
        }),
        tap((editReportNamePopover) => editReportNamePopover.present()),
        switchMap(
          (editReportNamePopover) => editReportNamePopover.onWillDismiss() as Promise<{ data: { reportName: string } }>
        )
      )
      .subscribe((editReportNamePopoverDetails) => {
        const newReportName = editReportNamePopoverDetails?.data?.reportName;
        if (newReportName) {
          this.updateReportName(newReportName);
        }
      });
  }
}
