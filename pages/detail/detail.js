// pages/detail/detail.js
const app = getApp()

const CATEGORY_MAP = {
  gift:       { icon: '🎁', bg: 'bg-pink',   label: '礼品', color: '#FF85A1' },
  decoration: { icon: '🎨', bg: 'bg-orange', label: '布置', color: '#FFC069' },
  event:      { icon: '🎉', bg: 'bg-purple', label: '活动', color: '#B37FEB' },
  trip:       { icon: '🌳', bg: 'bg-green',  label: '活动', color: '#5CD08A' },
  supplies:   { icon: '📚', bg: 'bg-blue',   label: '文具', color: '#69B2F8' },
  food:       { icon: '🍭', bg: 'bg-blue',   label: '食品', color: '#69B2F8' },
  other:      { icon: '⭐', bg: 'bg-gray',   label: '其他', color: '#D9D9D9' },
}

Page({
  data: {
    activeTab: 'all',
    activeCategory: 'all',
    groupedRecords: [],
    // 汇总头部（分班费/专项）
    genIncomeStr: '0.00', genExpenseStr: '0.00', genBalanceStr: '0.00',
    spIncomeStr:  '0.00', spExpenseStr:  '0.00', spBalanceStr:  '0.00',
    // 兼容旧引用
    totalIncome: 0, totalIncomeStr: '0.00',
    totalExpense: 0, totalExpenseStr: '0.00',
    balanceStr: '0.00',
    chartData: [],
    loading: true,
    isFinance:    false,   // cashier || accountant
    isChair:      false,
    isCashier:    false,
    isAdmin:      false,   // all committee roles
    // 学年切换
    selectedYearTerm: '',
    availableYearTerms: [],
    // 原始数据缓存
    _expenses: [],
    _incomes: [],

    // ── 专项基金 ────────────────────────────────
    funds: [],
    fundsLoading: false,
    activeFund: null,
    fundActiveSubTab: 'all',
    fundRecords: [],
    fundTotalIncome: 0, fundTotalIncomeStr: '0.00',
    fundTotalExpense: 0, fundTotalExpenseStr: '0.00',
    fundBalanceStr: '0.00',
    fundBalance: 0,
    fundDetailLoading: false,
    transferring: false,
  },

  async onShow() {
    await app.waitLogin()
    const role = app.globalData.role
    this.setData({
      isFinance: role === 'cashier' || role === 'accountant',
      isChair:   role === 'chair',
      isCashier: role === 'cashier',
      isAdmin:   ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member'].includes(role),
    })
    if (app.globalData.detailTab) {
      this.setData({ activeTab: app.globalData.detailTab })
      app.globalData.detailTab = null
    }
    await this.loadYearTerms()
    this.loadAllData()
    // 从 add 页返回且携带专项刷新标记
    const refreshFundId = app.globalData._refreshFundId
    if (refreshFundId) {
      app.globalData._refreshFundId = null
      this.loadFundDetail(refreshFundId)
      return
    }
    if (this.data.activeTab === 'fund') {
      this.loadFunds()
      if (this.data.activeFund) this.loadFundDetail(this.data.activeFund._id)
    }
  },

  async loadYearTerms() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'getYearTerms' },
      })
      const fromDB = result.yearTerms || []
      const current = app.globalData.yearTerm
      if (current && !fromDB.includes(current)) fromDB.unshift(current)
      const terms = fromDB.length > 0 ? fromDB : (current ? [current] : [])
      const selected = (this.data.selectedYearTerm && terms.includes(this.data.selectedYearTerm))
        ? this.data.selectedYearTerm
        : (current || terms[0] || '')
      this.setData({ availableYearTerms: terms, selectedYearTerm: selected })
    } catch (e) {
      console.error('loadYearTerms', e)
      const current = app.globalData.yearTerm
      if (current) this.setData({ availableYearTerms: [current], selectedYearTerm: current })
    }
  },

  switchYearTerm(e) {
    const yt = e.currentTarget.dataset.yt
    if (yt === this.data.selectedYearTerm) return
    this.setData({ selectedYearTerm: yt, activeCategory: 'all', activeFund: null })
    this.loadAllData()
    if (this.data.activeTab === 'fund') this.loadFunds()
  },

  async loadAllData() {
    this.setData({ loading: true })
    const yearTerm = this.data.selectedYearTerm || app.globalData.yearTerm
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'getSummary', yearTerm },
      })
      const allExpenses = result.expenses || []
      const allIncomes  = result.incomes  || []
      // 班费（无 fundId）
      const expenses = allExpenses.filter(r => !r.fundId)
      const incomes  = allIncomes.filter(r => !r.fundId)
      // 专项汇总
      const spIncomes  = allIncomes.filter(r => !!r.fundId)
      const spExpenses = allExpenses.filter(r => !!r.fundId)

      const genIncome  = incomes.reduce((s, r) => s + (r.amount || 0), 0)
      const genExpense = expenses.reduce((s, r) => s + (r.amount || 0), 0)
      const spIncome   = spIncomes.reduce((s, r) => s + (r.amount || 0), 0)
      const spExpense  = spExpenses.reduce((s, r) => s + (r.amount || 0), 0)
      const genBalance = genIncome - genExpense
      const spBalance  = spIncome - spExpense
      const totalIncome  = genIncome + spIncome
      const totalExpense = genExpense + spExpense
      this.setData({
        _expenses: expenses,
        _incomes:  incomes,
        totalIncome, totalExpense,
        genIncomeStr:  fmt(genIncome),
        genExpenseStr: fmt(genExpense),
        genBalanceStr: fmt(genBalance),
        spIncomeStr:   fmt(spIncome),
        spExpenseStr:  fmt(spExpense),
        spBalanceStr:  fmt(spBalance),
        loading: false,
      })
    } catch (err) {
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
      console.error(err)
      this.setData({ loading: false })
    }
    this.applyFilters()
    this.buildChartData()
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab, activeCategory: 'all' })
    if (tab === 'fund') {
      this.loadFunds()
    } else {
      this.applyFilters()
      this.buildChartData()
    }
  },

  filterCategory(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.cat })
    this.applyFilters()
  },

  applyFilters() {
    const { activeTab, activeCategory, _expenses, _incomes } = this.data
    let records = []
    if (activeTab !== 'income') {
      let exps = _expenses
      if (activeCategory !== 'all') exps = exps.filter(r => r.category === activeCategory)
      records.push(...exps.map(r => formatExpenseRecord(r)))
    }
    if (activeTab !== 'expense') {
      records.push(..._incomes.map(r => formatIncomeRecord(r)))
    }
    records.sort((a, b) => new Date(b.date) - new Date(a.date))
    this.setData({ groupedRecords: groupByMonth(records) })
  },

  buildChartData() {
    const { _expenses } = this.data
    const totals = {}
    let total = 0
    _expenses.forEach(r => {
      const cat = r.category || 'other'
      totals[cat] = (totals[cat] || 0) + r.amount
      total += r.amount
    })
    if (total === 0) { this.setData({ chartData: [] }); return }
    const chartData = Object.entries(totals).map(([cat, amt]) => {
      const info = CATEGORY_MAP[cat] || CATEGORY_MAP.other
      return { icon: info.icon, label: info.label, color: info.color, percent: Math.round(amt / total * 100) }
    }).sort((a, b) => b.percent - a.percent)
    this.setData({ chartData })
  },

  viewRecord(e) {
    const { id, type } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/record/record?id=${id}&type=${type}` })
  },

  onPullDownRefresh() {
    const p = [this.loadAllData()]
    if (this.data.activeTab === 'fund') p.push(this.loadFunds())
    Promise.all(p).then(() => wx.stopPullDownRefresh())
  },

  // ─── 专项基金列表 ────────────────────────────
  async loadFunds() {
    this.setData({ fundsLoading: true })
    const yearTerm = this.data.selectedYearTerm || app.globalData.yearTerm
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'listFunds', yearTerm },
      })
      this.setData({ funds: (result.funds || []).map(f => ({
        ...f,
        statusLabel: f.status === 'active' ? '进行中' : '已结束',
        feeStr:      Number(f.feePerStudent).toFixed(2),
      })) })
    } catch (e) {
      console.error('loadFunds', e)
    } finally {
      this.setData({ fundsLoading: false })
    }
  },

  createFund() {
    wx.showModal({
      title: '新建专项活动',
      editable: true,
      placeholderText: '活动名称，如：集体生日会',
      success: res1 => {
        if (!res1.confirm) return
        const name = (res1.content || '').trim()
        if (!name) { wx.showToast({ title: '请输入活动名称', icon: 'none' }); return }
        wx.showModal({
          title: `「${name}」每人收费`,
          editable: true,
          placeholderText: '金额（元），如：30',
          success: async res2 => {
            if (!res2.confirm) return
            const fee = parseFloat(res2.content || '')
            if (!fee || fee <= 0) {
              wx.showToast({ title: '金额无效', icon: 'none' }); return
            }
            try {
              const yearTerm = this.data.selectedYearTerm || app.globalData.yearTerm
              const { result } = await wx.cloud.callFunction({
                name: 'getUserList',
                data: { action: 'createFund', name, feePerStudent: fee, yearTerm },
              })
              if (!result.success) {
                wx.showToast({ title: result.error || '创建失败', icon: 'none' }); return
              }
              wx.showToast({ title: '创建成功', icon: 'success' })
              this.loadFunds()
            } catch (e) {
              console.error('createFund', e)
              wx.showToast({ title: e.message || '创建失败，请重试', icon: 'none' })
            }
          },
        })
      },
    })
  },

  // ─── 专项详情（二层） ─────────────────────────
  async openFundDetail(e) {
    const fund = e.currentTarget.dataset.fund
    this.setData({ activeFund: fund, fundActiveSubTab: 'all', fundDetailLoading: true })
    await this.loadFundDetail(fund._id)
  },

  closeFundDetail() {
    this.setData({ activeFund: null })
  },

  async loadFundDetail(fundId) {
    this.setData({ fundDetailLoading: true })
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'getFundSummary', fundId },
      })
      const incomes  = result.incomes  || []
      const expenses = result.expenses || []
      const totalIncome  = incomes.reduce((s, r) => s + (r.amount || 0), 0)
      const totalExpense = expenses.reduce((s, r) => s + (r.amount || 0), 0)
      const balance = totalIncome - totalExpense
      this.setData({
        activeFund:         result.fund,
        _fundExpenses:      expenses,
        _fundIncomes:       incomes,
        fundTotalIncome:    totalIncome,  fundTotalIncomeStr:  fmt(totalIncome),
        fundTotalExpense:   totalExpense, fundTotalExpenseStr: fmt(totalExpense),
        fundBalance:        balance,      fundBalanceStr:      fmt(Math.abs(balance)),
        fundDetailLoading:  false,
      })
    } catch (e) {
      console.error('loadFundDetail', e)
      this.setData({ fundDetailLoading: false })
    }
    this.applyFundFilters()
  },

  switchFundSubTab(e) {
    this.setData({ fundActiveSubTab: e.currentTarget.dataset.tab })
    this.applyFundFilters()
  },

  applyFundFilters() {
    const { fundActiveSubTab } = this.data
    const exps = this.data._fundExpenses || []
    const incs = this.data._fundIncomes  || []
    let records = []
    if (fundActiveSubTab !== 'income')  records.push(...exps.map(r => formatExpenseRecord(r)))
    const fundName = (this.data.activeFund && this.data.activeFund.name) || ''
    if (fundActiveSubTab !== 'expense') records.push(...incs.map(r => formatIncomeRecord(r, fundName)))
    records.sort((a, b) => new Date(b.date) - new Date(a.date))
    this.setData({ fundRecords: records })
  },

  goAddFundExpense() {
    const { activeFund } = this.data
    if (!activeFund) return
    wx.navigateTo({
      url: `/pages/add/add?type=expense&fundId=${activeFund._id}&fundName=${encodeURIComponent(activeFund.name)}`,
    })
  },

  goAddFundIncome() {
    const { activeFund } = this.data
    if (!activeFund) return
    wx.navigateTo({
      url: `/pages/add/add?type=income&fundId=${activeFund._id}&fundName=${encodeURIComponent(activeFund.name)}`,
    })
  },

  // ── 长按专项卡片 → 删除整个专项 ─────────────────
  onFundCardLongPress(e) {
    const { isCashier, isChair } = this.data
    if (!isCashier && !isChair) return
    const fund = e.currentTarget.dataset.fund
    wx.showModal({
      title: `删除「${fund.name}」`,
      content: '将同时删除该专项下所有收支记录，此操作不可撤销。',
      confirmText: '确认删除',
      confirmColor: '#FF4D4F',
      success: async res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        try {
          const { result } = await wx.cloud.callFunction({
            name: 'getUserList',
            data: { action: 'deleteFund', fundId: fund._id },
          })
          if (!result.success) {
            wx.showToast({ title: result.error || '删除失败', icon: 'none' }); return
          }
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadFunds()
          this.loadAllData()
        } catch (e) {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      },
    })
  },

  // ── 长按专项详情内记录 → 删除单条 ─────────────────
  onFundRecordLongPress(e) {
    const { isCashier, isChair } = this.data
    if (!isCashier && !isChair) return
    const { id, type, name } = e.currentTarget.dataset
    wx.showModal({
      title: '删除记录',
      content: `确认删除「${name || '该记录'}」？此操作不可撤销。`,
      confirmText: '确认删除',
      confirmColor: '#FF4D4F',
      success: async res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        try {
          const { result } = await wx.cloud.callFunction({
            name: 'getUserList',
            data: { action: 'deleteFundRecord', recordId: id, recordType: type },
          })
          if (!result.success) {
            wx.showToast({ title: result.error || '删除失败', icon: 'none' }); return
          }
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadFundDetail(this.data.activeFund._id)
          this.loadAllData()
        } catch (e) {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      },
    })
  },

  transferFundBalance() {
    const { activeFund, fundBalance } = this.data
    if (!activeFund || fundBalance <= 0) return
    wx.showModal({
      title: '结余转入班费',
      content: `将「${activeFund.name}」结余 ¥${fmt(fundBalance)} 转入班费，并关闭此专项。\n\n此操作不可撤销。`,
      confirmText: '确认转入',
      confirmColor: '#07C160',
      success: async res => {
        if (!res.confirm) return
        this.setData({ transferring: true })
        try {
          const { result } = await wx.cloud.callFunction({
            name: 'getUserList',
            data: { action: 'transferFundBalance', fundId: activeFund._id },
          })
          if (!result.success) {
            wx.showToast({ title: result.error || '操作失败', icon: 'none' }); return
          }
          wx.showToast({ title: `¥${fmt(result.transferAmount)} 已转入班费`, icon: 'success', duration: 2500 })
          this.loadFunds()
          this.loadFundDetail(activeFund._id)
          this.loadAllData()
        } catch (e) {
          wx.showToast({ title: '操作失败，请重试', icon: 'none' })
        } finally {
          this.setData({ transferring: false })
        }
      },
    })
  },

  exportCSV() {
    const { _expenses, _incomes, selectedYearTerm } = this.data
    const rows = [['类型','日期','金额','说明','类目','垫付人','报销状态','学生姓名','学号','收款方式']]
    _expenses.forEach(r => {
      const cat = CATEGORY_MAP[r.category] || CATEGORY_MAP.other
      rows.push(['支出', r.date || '', r.amount, r.title || '', cat.label, r.advancer || '',
        r.reimbursementStatus === 'reimbursed' ? '已报销' : '未报销', '', '', ''])
    })
    _incomes.forEach(r => {
      rows.push(['收入', r.date || '', r.amount, '学年班费', '', '', '',
        r.childName || r.payer || '', r.studentNo || '', r.payMethod || ''])
    })
    const escapeCell = v => {
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = '\uFEFF' + rows.map(r => r.map(escapeCell).join(',')).join('\n')
    const fileName = `班费账本_${selectedYearTerm}.csv`
    const path = `${wx.env.USER_DATA_PATH}/${fileName}`
    wx.showModal({
      title: '导出 CSV',
      content: '文件将发送到微信转发面板。\n\n请转发给「文件传输助手」，然后：\n· 手机：点击文件 → 「更多」→「存储到文件」\n· 电脑微信：直接点击下载',
      confirmText: '去导出',
      cancelText: '取消',
      success: res => {
        if (!res.confirm) return
        wx.getFileSystemManager().writeFile({
          filePath: path, data: csv, encoding: 'utf8',
          success: () => {
            wx.shareFileMessage({
              filePath: path, fileName,
              fail: () => wx.showToast({ title: '模拟器不支持，请在真机上操作', icon: 'none', duration: 3000 }),
            })
          },
          fail: () => wx.showToast({ title: '写入文件失败', icon: 'none' }),
        })
      },
    })
  },
})

function fmt(n) {
  return Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return `${String(d.getMonth()+1).padStart(2,'0')}月${String(d.getDate()).padStart(2,'0')}日`
}
function fmtMonth(s) {
  if (!s) return ''
  const d = new Date(s)
  return `${d.getFullYear()}年${d.getMonth()+1}月`
}
function formatExpenseRecord(r) {
  const cat = CATEGORY_MAP[r.category] || CATEGORY_MAP.other
  return {
    _id: r._id, recordType: 'expense',
    displayName: r.title || '支出记录',
    displayDate: fmtDate(r.date), date: r.date,
    amountStr: `−¥${fmt(r.amount)}`,
    icon: cat.icon, iconBg: cat.bg, categoryLabel: cat.label,
    receiptsCount: (r.receipts || []).length,
    reimbursementStatus: r.reimbursementStatus || 'unreimbursed',
  }
}
function formatIncomeRecord(r, fundName) {
  if (r.isOpeningBalance) {
    return {
      _id: r._id, recordType: 'income',
      displayName: '期初结余',
      displayDate: fmtDate(r.date), date: r.date,
      amountStr: `+¥${fmt(r.amount)}`,
      icon: '💰', iconBg: 'bg-green', categoryLabel: '结转',
      receiptsCount: 0,
    }
  }
  const prefix = r.studentNo ? r.studentNo + ' ' : ''
  const studentLabel = prefix + (r.childName || r.payer || '未知')
  const label = fundName || '学年班费'
  return {
    _id: r._id, recordType: 'income',
    displayName: studentLabel + ' · ' + label,
    displayDate: fmtDate(r.date), date: r.date,
    amountStr: `+¥${fmt(r.amount)}`,
    icon: '💚', iconBg: 'bg-green-light', categoryLabel: '',
    receiptsCount: 0,
  }
}
function groupByMonth(records) {
  const map = {}
  records.forEach(r => {
    const key = fmtMonth(r.date)
    if (!map[key]) map[key] = []
    map[key].push(r)
  })
  return Object.entries(map).map(([month, recs]) => ({ month, records: recs }))
}
