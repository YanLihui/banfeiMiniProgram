// pages/profile/profile.js
const app = getApp()

const COMMITTEE_ROLES = ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member']

Page({
  data: {
    isAdmin:   false,
    isChair:   false,
    isFinance: false,   // cashier || accountant（导出/报告）
    isCashier: false,   // cashier 独有（收费/报销入账）
    isMember:  false,
    userInfo: {},
    nameInitial: '?',
    className: '',
    yearTerm: '',
    collectedCount: 0,
    expenseCount: 0,
    pendingCount: 0,
    totalStudents: 45,
    pendingClaimsCount: 0,

    // 编辑姓名弹窗
    showEditModal: false,
    editName: '',
    editChildName: '',
    editClassName: '',
    editYearTerm: '',
    savingProfile: false,
    // 花名册 picker（编辑弹窗用）
    rosterOptions: [],
    rosterStudents: [],
    rosterPickerIdx: 0,
    rosterLoaded: false,

    // 期初结余弹窗
    showOpeningBalanceModal: false,
    openingAmount: '',
    openingNotes: '',
    savingOpeningBalance: false,
    newTermInput: '',
    newFeeInput: '',
    startingNewTerm: false,

    // 账目报告数据
    showReportModal: false,
    reportLoading: false,
    report: null,
    reportYearTerm: '',       // 当前报告展示的学年
    availableYearTerms: [],   // 所有有记录的学年列表
  },

  async onShow() {
    try {
      await app.waitLogin()
    } catch (e) {
      wx.showToast({ title: '登录超时，请重启', icon: 'none' })
      console.error('waitLogin failed', e)
      return
    }
    const role = app.globalData.role
    const isAdmin   = COMMITTEE_ROLES.includes(role)
    const isChair   = role === 'chair'
    const isFinance = role === 'cashier' || role === 'accountant'
    const isCashier = role === 'cashier'
    const isMember  = role === 'member'
    this.setData({
      isAdmin,
      isChair,
      isFinance,
      isCashier,
      isMember,
      className:    app.globalData.className,
      yearTerm:     app.globalData.yearTerm,
      totalStudents: app.globalData.totalStudents,
    })
    this.loadUserInfo()
    this.loadStats()
    if (isAdmin) this.loadPendingClaimsCount()
    this.loadRosterForEdit()  // 预加载花名册，避免编辑弹窗打开后重排

    // 处理首页快捷入口的跳转标记
    if (app.globalData._openReport) {
      app.globalData._openReport = false
      this.openReport()
    } else if (app.globalData._openNewTerm) {
      app.globalData._openNewTerm = false
      this.openNewTermModal()
    }
  },

  async loadUserInfo() {
    const db = wx.cloud.database()
    try {
      const res = await db.collection('users')
        .where({ _openid: app.globalData.openid })
        .limit(1).get()
      if (res.data.length > 0) {
        const u = res.data[0]
        const initial = (u.name || '?')[0]
        this.setData({ userInfo: u, nameInitial: initial })
      } else {
        // users 里没有记录，跳转 onboard 补填
        wx.reLaunch({ url: '/pages/onboard/onboard' })
      }
    } catch (e) {
      wx.showToast({ title: '加载用户信息失败', icon: 'none' })
      console.error('loadUserInfo', e)
    }
  },

  async loadStats() {
    const yearTerm = app.globalData.yearTerm
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'getStats', yearTerm },
      })
      const collectedCount = result.incomeCount  || 0
      const expenseCount   = result.expenseCount || 0
      const pendingCount   = this.data.totalStudents - collectedCount
      this.setData({ collectedCount, expenseCount, pendingCount: Math.max(0, pendingCount) })
    } catch (e) { console.error(e) }
  },

  async loadPendingClaimsCount() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'getPending', yearTerm: app.globalData.yearTerm },
      })
      this.setData({ pendingClaimsCount: (result.payments || []).length })
    } catch (e) { console.error(e) }
  },

  goToCollect() { wx.navigateTo({ url: '/pages/add/add?type=income' }) },

  // ─── 期初结余 ────────────────────────────────
  openOpeningBalanceModal() {
    this.setData({ showOpeningBalanceModal: true, openingAmount: '', openingNotes: '' })
  },
  closeOpeningBalanceModal() {
    this.setData({ showOpeningBalanceModal: false })
  },
  onOpeningInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },
  async saveOpeningBalance() {
    const { openingAmount, openingNotes } = this.data
    const amt = parseFloat(openingAmount)
    if (!openingAmount || isNaN(amt) || amt <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' }); return
    }
    this.setData({ savingOpeningBalance: true })
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: {
          action:   'setOpeningBalance',
          amount:   amt,
          notes:    openingNotes.trim(),
          yearTerm: app.globalData.yearTerm,
        },
      })
      if (!result.success) {
        wx.showToast({ title: result.error || '设置失败', icon: 'none', duration: 3000 }); return
      }
      wx.showToast({ title: `期初结余 ¥${amt.toFixed(2)} 已录入`, icon: 'success' })
      this.closeOpeningBalanceModal()
    } catch (e) {
      wx.showToast({ title: '网络错误，请重试', icon: 'none' })
    } finally {
      this.setData({ savingOpeningBalance: false })
    }
  },  goToAdd()     { wx.navigateTo({ url: '/pages/add/add?type=expense' }) },
  goToMembers() { wx.navigateTo({ url: '/pages/members/members' }) },
  goToRoles()   { wx.navigateTo({ url: '/pages/roles/roles' }) },
  goToConfirm() { wx.navigateTo({ url: '/pages/confirm/confirm' }) },
  goToNotice()  { wx.showToast({ title: '功能开发中', icon: 'none' }) },
  goToAbout()   { wx.showToast({ title: '班费管理 v1.0.0', icon: 'none' }) },
  goToPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }) },

  // ─── 编辑姓名 ────────────────────────────────
  editProfile() {
    const u = this.data.userInfo
    this.setData({
      showEditModal: true,
      editName:      u.name      || '',
      editChildName: u.childName || '',
      editClassName: app.globalData.className || '',
      editYearTerm:  app.globalData.yearTerm  || '',
    })
    this.loadRosterForEdit()
  },

  async loadRosterForEdit() {
    if (this.data.rosterLoaded) return
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'importMembers',
        data: { action: 'list' },
      })
      const raw = result.data || []
      const students = raw
        .filter(s => s.name)
        .sort((a, b) => (parseInt(a.studentNo) || 99) - (parseInt(b.studentNo) || 99))
        .map(s => ({ studentNo: s.studentNo || '', name: s.name }))
      const options = students.map(s =>
        `${String(s.studentNo || '--').padStart(2, '0')}  ${s.name}`
      )
      const currentChild = this.data.editChildName
      const idx = currentChild ? students.findIndex(s => s.name === currentChild) : -1
      this.setData({
        rosterStudents: students,
        rosterOptions: options,
        rosterLoaded: true,
        rosterPickerIdx: idx >= 0 ? idx : 0,
      })
    } catch (e) {
      console.error('loadRosterForEdit', e)
      this.setData({ rosterLoaded: true })
    }
  },

  onRosterPickerChange(e) {
    const idx = parseInt(e.detail.value)
    const s = this.data.rosterStudents[idx]
    if (!s) return
    this.setData({ rosterPickerIdx: idx, editChildName: s.name })
  },

  onEditInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  hideEditModal() {
    this.setData({ showEditModal: false })
  },

  noop() {},

  async saveProfile() {
    const { editName, editChildName, editClassName, editYearTerm } = this.data
    if (!editChildName.trim()) {
      wx.showToast({ title: '请填写孩子姓名', icon: 'none' }); return
    }
    this.setData({ savingProfile: true })
    try {
      // 保存个人信息（通过云函数，服务端校验）
      const profileRes = await wx.cloud.callFunction({
        name: 'getUserList',
        data: {
          action:    'updateUserProfile',
          name:      editName.trim(),
          childName: editChildName.trim(),
        },
      })
      if (!profileRes.result.success) {
        wx.showToast({ title: profileRes.result.error || '保存失败', icon: 'none' }); return
      }

      // 仅家委发言人可修改班级设置
      if (app.globalData.role === 'chair' && editClassName.trim()) {
        const { result } = await wx.cloud.callFunction({
          name: 'getUserList',
          data: {
            action:    'updateClassSettings',
            className: editClassName.trim(),
            yearTerm:  editYearTerm.trim(),
          },
        })
        if (!result.success) {
          wx.showToast({ title: result.error || '班级设置保存失败', icon: 'none' }); return
        }
        app.globalData.className = editClassName.trim()
        app.globalData.yearTerm  = editYearTerm.trim()
        this.setData({ className: editClassName.trim() })
      }

      const initial = (editChildName.trim() || editName.trim() || '?')[0]
      this.setData({
        'userInfo.name':      editName.trim(),
        'userInfo.childName': editChildName.trim(),
        nameInitial: initial,
        showEditModal: false,
      })
      wx.showToast({ title: '保存成功', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' })
      console.error(err)
    } finally {
      this.setData({ savingProfile: false })
    }
  },

  // ─── 新学期收费 ──────────────────────────────
  openNewTermModal() {
    const yt = app.globalData.yearTerm || ''
    // 自动推算下一学年，如 "2024-2025" → "2025-2026"
    let nextTerm = ''
    const m = yt.match(/^(\d{4})-(\d{4})$/)
    if (m) nextTerm = `${Number(m[1]) + 1}-${Number(m[2]) + 1}`
    this.setData({
      showNewTermModal: true,
      newTermInput: nextTerm,
      newFeeInput:  String(app.globalData.feePerStudent || ''),
    })
  },

  closeNewTermModal() {
    this.setData({ showNewTermModal: false })
  },

  onNewTermInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  async confirmNewTerm() {
    const { newTermInput, newFeeInput } = this.data
    const yt = newTermInput.trim()
    const fee = parseFloat(newFeeInput)

    if (!yt) return wx.showToast({ title: '请填写新学年', icon: 'none' })
    if (!fee || fee <= 0) return wx.showToast({ title: '请填写有效金额', icon: 'none' })

    wx.showModal({
      title: '确认开启新学期',
      content: `将切换到学年 ${yt}，每人班费 ¥${fee.toFixed(2)}。\n所有家长的缴费状态将自动重置为未缴费（旧记录保留）。`,
      confirmText: '确认开启',
      confirmColor: '#07C160',
      success: async res => {
        if (!res.confirm) return
        this.setData({ startingNewTerm: true })
        const db = wx.cloud.database()
        try {
          const settingsData = { yearTerm: yt, feePerStudent: fee }
          const settingsRes = await db.collection('classSettings').limit(1).get()
          if (settingsRes.data.length > 0) {
            await db.collection('classSettings').doc(settingsRes.data[0]._id).update({ data: settingsData })
          } else {
            await db.collection('classSettings').add({
              data: { ...settingsData, className: app.globalData.className },
            })
          }
          app.globalData.yearTerm = yt
          app.globalData.feePerStudent = fee
          this.setData({
            yearTerm: yt,
            showNewTermModal: false,
          })
          // 刷新统计（新学期没有 incomes）
          this.loadStats()
          wx.showToast({ title: `已开启 ${yt} 学年`, icon: 'success' })
        } catch (err) {
          wx.showToast({ title: '操作失败，请重试', icon: 'none' })
          console.error(err)
        } finally {
          this.setData({ startingNewTerm: false })
        }
      },
    })
  },

  // ─── 账目报告 ────────────────────────────────
  async openReport() {
    // 加载可用学年列表（首次打开时）
    if (this.data.availableYearTerms.length === 0) {
      try {
        const { result } = await wx.cloud.callFunction({
          name: 'getUserList',
          data: { action: 'getYearTerms' },
        })
        const fromDB = result.yearTerms || []
        const current = app.globalData.yearTerm
        if (current && !fromDB.includes(current)) fromDB.unshift(current)
        const terms = fromDB.length > 0 ? fromDB : (current ? [current] : [])
        this.setData({ availableYearTerms: terms })
      } catch (e) {
        console.error('getYearTerms', e)
      }
    }
    const yearTerm = this.data.reportYearTerm || app.globalData.yearTerm
    this.setData({ showReportModal: true, reportYearTerm: yearTerm })
    this.loadReport(yearTerm)
  },

  async switchReportYear(e) {
    const yt = e.currentTarget.dataset.yt
    if (yt === this.data.reportYearTerm) return
    this.setData({ reportYearTerm: yt })
    this.loadReport(yt)
  },

  async loadReport(yearTerm) {
    this.setData({ reportLoading: true, report: null })
    const feePerStudent = app.globalData.feePerStudent
    const totalStudents = app.globalData.totalStudents
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'getSummary', yearTerm },
      })
      const incomes  = result.incomes  || []
      const expenses = result.expenses || []
      const totalIncome  = incomes.reduce((s, r) => s + (r.amount || 0), 0)
      const totalExpense = expenses.reduce((s, r) => s + (r.amount || 0), 0)
      const balance      = totalIncome - totalExpense
      const expected     = feePerStudent * totalStudents
      const collectedCount = incomes.length
      this.setData({
        reportLoading: false,
        report: {
          expectedStr:      fmt(expected),
          totalIncomeStr:   fmt(totalIncome),
          totalExpenseStr:  fmt(totalExpense),
          balanceStr:       fmt(Math.abs(balance)),
          balanceNeg:       balance < 0,
          collectedCount,
          totalStudents,
          uncollectedCount: Math.max(0, totalStudents - collectedCount),
          uncollectedStr:   fmt(Math.max(0, expected - totalIncome)),
        },
      })
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ showReportModal: false })
      console.error(err)
    }
  },

  closeReport() {
    this.setData({ showReportModal: false })
  },

  exportReport() {
    wx.showToast({ title: '正在生成报表...', icon: 'loading' })
    // 后续可用云函数生成 Excel 并下载
  },

  logout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后需重新授权登录',
      success: res => {
        if (res.confirm) {
          app.globalData.openid = null
          app.globalData.role = 'parent'
          wx.reLaunch({ url: '/pages/index/index' })
        }
      },
    })
  },
})

function fmt(num) {
  return Number(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
