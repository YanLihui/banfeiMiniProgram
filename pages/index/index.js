// pages/index/index.js
const app = getApp()
const COMMITTEE_ROLES = ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member']

// 支出类目图标映射
const CATEGORY_MAP = {
  gift:       { icon: '🎁', bg: 'bg-pink',   label: '礼品' },
  decoration: { icon: '🎨', bg: 'bg-orange', label: '布置' },
  event:      { icon: '🎉', bg: 'bg-purple', label: '活动' },
  trip:       { icon: '🌳', bg: 'bg-green',  label: '活动' },
  supplies:   { icon: '📚', bg: 'bg-blue',   label: '文具' },
  food:       { icon: '🍭', bg: 'bg-blue',   label: '食品' },
  other:      { icon: '⭐', bg: 'bg-gray',   label: '其他' },
}

Page({
  data: {
    // 用户信息（初始全 false，onShow 里按 role 正确赋值）
    role:         '',
    isCommittee:  false,
    isFinance:    false,   // cashier || accountant（导出/报告）
    isCashier:    false,   // cashier 独有（收费/报销）
    isChair:      false,
    isMember:     false,
    blocked: false,
    needSetup: false,
    rosterEmpty: false,   // 花名册为空，提示主任导入
    className: '',
    yearTerm: '',
    totalStudents: 45,
    feePerStudent: 200,

    // 财务汇总
    balance: 0,
    generalBalance: 0, generalBalanceStr: '0.00',
    fundBalance: 0,    fundBalanceStr: '0.00',
    totalIncome: 0,
    generalIncome: 0,  generalIncomeStr: '0.00',
    fundIncome: 0,     fundIncomeStr: '0.00',
    totalExpense: 0,   totalExpenseStr: '0.00',
    generalExpense: 0, generalExpenseStr: '0.00',
    fundExpense: 0,    fundExpenseStr: '0.00',
    collectedCount: 0,
    fundIncomeCount: 0,
    generalExpenseCount: 0,
    fundExpenseCount: 0,
    expenseCount: 0,
    collectionPercent: 0,
    pendingCount: 0,

    // 列表
    recentRecords: [],
    notice: '',
    loading: true,

    // 学年切换
    selectedYearTerm: '',
    availableYearTerms: [],
    isHistoricalView: false,   // 是否正在查看历史学年

    // 缴费状态（家长端）'unknown' | 'unpaid' | 'pending' | 'paid'
    payStatus: 'unknown',
    submittingClaim: false,

    // 公告编辑弹窗
    showNoticeEditor: false,
    noticeInput: '',
    noticeSaving: false,
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight,
      className: app.globalData.className,
      yearTerm: app.globalData.yearTerm,
      totalStudents: app.globalData.totalStudents,
      feePerStudent: app.globalData.feePerStudent,
    })
  },

  async onShow() {
    await app.waitLogin()
    const role = app.globalData.role

    // 委员不强制要求填孩子姓名（花名册验证可跳过）
    const isCommittee = COMMITTEE_ROLES.includes(role)
    if (!app.globalData.childName && !isCommittee) {
      wx.reLaunch({ url: '/pages/onboard/onboard' })
      return
    }

    const isFinance   = role === 'cashier' || role === 'accountant'
    const isCashier   = role === 'cashier'
    const isChair     = role === 'chair'
    const isMember    = role === 'member'

    this.setData({
      role,
      isCommittee,
      isFinance,
      isCashier,
      isChair,
      isMember,
      blocked:       role === 'none',
      needSetup:     false,
      className:     app.globalData.className,
      yearTerm:      app.globalData.yearTerm,
      totalStudents: app.globalData.totalStudents || 0,
      feePerStudent: app.globalData.feePerStudent || 0,
    })
    if (role === 'none') return
    await this.loadYearTerms()
    this.loadData()
    this.loadPaymentStatus()
    if (role === 'chair') this.checkRoster()
  },

  async checkRoster() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'importMembers',
        data: { action: 'list' },
      })
      this.setData({ rosterEmpty: (result.data || []).length === 0 })
    } catch (e) {}
  },

  // ─── 学年切换 ────────────────────────────────
  async loadYearTerms() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'getYearTerms' },
      })
      const fromDB = result.yearTerms || []
      // 以 globalData.yearTerm 为当前学年，若还未加载则用 DB 中最新一条
      const current = app.globalData.yearTerm || fromDB[0] || ''
      if (current && !fromDB.includes(current)) fromDB.unshift(current)
      const terms = fromDB.length > 0 ? fromDB : (current ? [current] : [])
      // 默认选中当前学年（不保留之前选的历史学年，避免跨 onShow 状态残留）
      const selected = current || terms[0] || ''
      const isHistoricalView = !!selected && !!current && selected !== current
      this.setData({
        availableYearTerms: terms,
        selectedYearTerm: selected,
        yearTerm: selected,
        isHistoricalView,
      })
    } catch (e) {
      const current = app.globalData.yearTerm
      this.setData({
        availableYearTerms: current ? [current] : [],
        selectedYearTerm: current || '',
        isHistoricalView: false,
      })
    }
  },

  pickYearTerm() {
    const { availableYearTerms, selectedYearTerm } = this.data
    if (availableYearTerms.length <= 1) {
      wx.showToast({ title: '暂无其他学年数据', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: availableYearTerms.map(yt => yt + ' 学年' + (yt === app.globalData.yearTerm ? '（当前）' : '')),
      success: res => {
        const picked = availableYearTerms[res.tapIndex]
        if (picked === selectedYearTerm) return
        const isHistoricalView = picked !== app.globalData.yearTerm
        this.setData({ selectedYearTerm: picked, isHistoricalView, yearTerm: picked })
        this.loadData()
      },
    })
  },

  // ─── 数据加载 ────────────────────────────────
  async loadData() {
    this.setData({ loading: true })
    try {
      await Promise.all([
        this.loadSummary(),
        this.loadNotice(),
      ])
    } catch (err) {
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadSummary() {
    const yearTerm = this.data.selectedYearTerm || app.globalData.yearTerm
    const { result } = await wx.cloud.callFunction({
      name: 'getUserList',
      data: { action: 'getSummary', yearTerm },
    })

    const incomes  = result.incomes  || []
    const expenses = result.expenses || []
    const generalIncomes  = incomes.filter(r => !r.fundId)
    const fundIncomes     = incomes.filter(r => !!r.fundId)
    const generalExpenses = expenses.filter(r => !r.fundId)
    const fundExpenses    = expenses.filter(r => !!r.fundId)
    const generalIncome  = generalIncomes.reduce((s, r) => s + (r.amount || 0), 0)
    const fundIncome     = fundIncomes.reduce((s, r) => s + (r.amount || 0), 0)
    const generalExpense = generalExpenses.reduce((s, r) => s + (r.amount || 0), 0)
    const fundExpense    = fundExpenses.reduce((s, r) => s + (r.amount || 0), 0)
    const totalIncome    = generalIncome + fundIncome
    const totalExpense   = generalExpense + fundExpense
    const generalBalance = generalIncome - generalExpense
    const fundBalance    = fundIncome - fundExpense
    const collectedCount = generalIncomes.filter(r => !r.isOpeningBalance).length
    const expenseCount   = expenses.length
    const collectionPercent = Math.round((collectedCount / this.data.totalStudents) * 100)
    const pendingCount = this.data.totalStudents - collectedCount

    // 最近记录合并
    const recentExpenses = (result.recentExpense || []).map(r => formatExpenseRecord(r))
    const recentIncomes  = (result.recentIncome  || []).map(r => formatIncomeRecord(r))
    const recentRecords  = [...recentExpenses, ...recentIncomes]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 6)

    this.setData({
      totalIncome, totalExpense,
      generalIncome,  generalIncomeStr:  fmt(generalIncome),
      fundIncome,     fundIncomeStr:     fmt(fundIncome),
      generalExpense, generalExpenseStr: fmt(generalExpense),
      fundExpense,    fundExpenseStr:    fmt(fundExpense),
      generalBalance, generalBalanceStr: fmt(generalBalance),
      fundBalance,    fundBalanceStr:    fmt(fundBalance),
      fundIncomeCount:    fundIncomes.length,
      generalExpenseCount: generalExpenses.length,
      fundExpenseCount:    fundExpenses.length,
      collectedCount, expenseCount,
      collectionPercent, pendingCount: Math.max(0, pendingCount),
      recentRecords,
    })
  },

  async loadNotice() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'getNotice' },
      })
      this.setData({ notice: result.notice || '' })
    } catch (e) {
      console.error('loadNotice', e)
    }
  },

  noop() {},

  onNoticeLongPress() {
    if (!this.data.isChair) return
    this.setData({ showNoticeEditor: true, noticeInput: this.data.notice })
  },

  onNoticeInput(e) {
    this.setData({ noticeInput: e.detail.value })
  },

  closeNoticeEditor() {
    this.setData({ showNoticeEditor: false })
  },

  async saveNotice() {
    if (this.data.noticeSaving) return
    this.setData({ noticeSaving: true })
    try {
      const newNotice = (this.data.noticeInput || '').trim()
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'setNotice', notice: newNotice },
      })
      if (!result.success) {
        wx.showToast({ title: result.error || '保存失败', icon: 'none' }); return
      }
      this.setData({ notice: newNotice, showNoticeEditor: false })
      wx.showToast({ title: newNotice ? '公告已更新' : '公告已清除', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ noticeSaving: false })
    }
  },

  // ─── 缴费状态（按 childName 查，多家长共享同一状态） ──
  async loadPaymentStatus() {
    const childName = app.globalData.childName
    const yearTerm  = app.globalData.yearTerm
    if (!yearTerm) return
    if (!childName) {
      this.setData({ payStatus: 'unknown' })
      return
    }

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'getFeeStatus', yearTerm },
      })
      this.setData({ payStatus: result.status || 'unpaid' })
    } catch (e) {
      console.error('loadPaymentStatus', e)
    }
  },

  async submitClaim() {
    if (this.data.submittingClaim) return
    if (!app.globalData.childName) {
      wx.showModal({
        title: '请先完善信息',
        content: '需要绑定孩子姓名才能提交缴费登记',
        confirmText: '去填写',
        confirmColor: '#07C160',
        success: res => {
          if (res.confirm) wx.switchTab({ url: '/pages/profile/profile' })
        },
      })
      return
    }

    this.setData({ submittingClaim: true })
    try {
      const yearTerm = app.globalData.yearTerm
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'submitFeeClaim', yearTerm },
      })
      if (result.duplicate) {
        const status = result.status
        this.setData({ payStatus: status === 'approved' ? 'paid' : 'pending' })
        wx.showToast({
          title: status === 'approved' ? '本学年班费已缴' : '缴费登记已提交，等待确认',
          icon: 'none', duration: 2500,
        })
        return
      }
      if (!result.success) {
        wx.showToast({ title: result.error || '提交失败', icon: 'none' }); return
      }
      this.setData({ payStatus: 'pending' })
      wx.showToast({ title: '已提交，等待出纳确认', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '提交失败，请重试', icon: 'none' })
      console.error(err)
    } finally {
      this.setData({ submittingClaim: false })
    }
  },

  // ─── 路由跳转 ────────────────────────────────
  goToDetail(e) {
    const tab = e.currentTarget.dataset.tab || 'all'
    wx.switchTab({ url: '/pages/detail/detail' })
    // 通过全局变量传 tab 参数（switchTab 不支持 query）
    app.globalData.detailTab = tab
  },

  goToAdd() {
    wx.navigateTo({ url: '/pages/add/add?type=expense' })
  },

  goToConfirm() {
    wx.navigateTo({ url: '/pages/confirm/confirm' })
  },

  goToMembers() {
    wx.navigateTo({ url: '/pages/members/members' })
  },

  goToRoles() {
    wx.navigateTo({ url: '/pages/roles/roles' })
  },

  goToReport() {
    // 跳转到个人中心并触发账目报告弹窗
    wx.switchTab({ url: '/pages/profile/profile' })
    // 用全局标记，profile onShow 读取后打开弹窗
    app.globalData._openReport = true
  },

  goToNewTerm() {
    wx.switchTab({ url: '/pages/profile/profile' })
    app.globalData._openNewTerm = true
  },

  goToCollect() {
    wx.navigateTo({ url: '/pages/add/add?type=income' })
  },

  goToProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  viewRecord(e) {
    const { id, type } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/record/record?id=${id}&type=${type}` })
  },

  onShareTap() {
    wx.showShareMenu({ withShareTicket: true })
  },

  // ─── 下拉刷新 ────────────────────────────────
  onPullDownRefresh() {
    this.loadData().then(() => wx.stopPullDownRefresh())
  },

  // ─── 分享 ────────────────────────────────────
  onShareAppMessage() {
    return {
      title: `${app.globalData.className} 班费账本 · 透明公开`,
      path: '/pages/index/index',
    }
  },
})

// ─── 工具函数 ──────────────────────────────────

// 数字格式化：1234.5 → "1,234.50"
function fmt(num) {
  return Number(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 日期格式化：2024-05-28 → "05月28日"
function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}月${day}日`
}

function formatExpenseRecord(r) {
  const cat = CATEGORY_MAP[r.category] || CATEGORY_MAP.other
  return {
    _id: r._id,
    recordType: 'expense',
    displayName: r.title || '支出记录',
    displayDate: fmtDate(r.date),
    date: r.date,
    amountStr: `−¥${fmt(r.amount)}`,
    icon: cat.icon,
    iconBg: cat.bg,
    receiptsCount: (r.receipts || []).length,
    reimbursementStatus: r.reimbursementStatus || 'unreimbursed',
  }
}

function formatIncomeRecord(r) {
  const prefix = r.studentNo ? `${r.studentNo} ` : ''
  const studentLabel = `${prefix}${r.childName || r.payer || '未知'}`
  return {
    _id: r._id,
    recordType: 'income',
    displayName: `${studentLabel} · 学年班费`,
    displayDate: fmtDate(r.date),
    date: r.date,
    amountStr: `+¥${fmt(r.amount)}`,
    icon: '💚',
    iconBg: 'bg-green-light',
    receiptsCount: 0,
  }
}
