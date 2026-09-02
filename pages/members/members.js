// pages/members/members.js
const app = getApp()

Page({
  data: {
    isAdmin: false,   // 任意委员：可见详情按钮
    isCashier: false, // 出纳：可见录入按钮
    isChair: false,   // 家委主任：可导入花名册
    totalStudents: 45,
    feePerStudent: 200,

    // 全量数据（计算后）
    _allMembers: [],

    // 展示用
    displayList: [],
    activeFilter: 'all',
    keyword: '',

    // 统计
    paidCount: 0,
    unpaidCount: 0,

    loading: true,

    // 导入弹窗
    showImportModal: false,
    importText: '',
    importCount: 0,
    importing: false,
    keyboardHeight: 0,

    // 编辑弹窗
    showEditModal: false,
    editMember: null,   // { _id, name, studentNo }
    editName: '',
    editStudentNo: '',
    editSaving: false,
  },

  async onLoad() {
    this.setData({
      totalStudents: app.globalData.totalStudents,
      feePerStudent: app.globalData.feePerStudent,
    })
  },

  async onShow() {
    await app.waitLogin()
    const role = app.globalData.role
    this.setData({
      isAdmin:   ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member'].includes(role),
      isCashier: role === 'cashier',
      isChair:   role === 'chair',
    })
    this.loadData()
  },

  // ─── 数据加载 ────────────────────────────────
  async loadData() {
    this.setData({ loading: true })
    try {
      const yearTerm = app.globalData.yearTerm

      // 花名册 + 收费数据均通过云函数读取，绕过客户端 _openid 限制
      const [membersResult, summaryResult] = await Promise.all([
        wx.cloud.callFunction({ name: 'importMembers', data: { action: 'list' } }),
        wx.cloud.callFunction({ name: 'getUserList', data: { action: 'getSummary', yearTerm } }),
      ])

      const studentsData = membersResult.result.data || []
      const incomeList   = summaryResult.result.incomes || []

      const paidMap = {}
      incomeList
        .filter(r => !r.isOpeningBalance)  // 排除期初结余
        .forEach(r => {
          const key = r.childName || r.payer || ''
          if (key && !paidMap[key]) paidMap[key] = r
        })

      let roster = studentsData
      if (roster.length === 0) {
        roster = this._buildRosterFromIncome(incomeList)
      }

      const members = roster.map(s => {
        const incomeRecord = paidMap[s.name] || paidMap[s.childName]
        const paid = !!incomeRecord
        return {
          _id:        s._id || '',
          name:       s.name || s.childName || '未知',
          studentNo:  s.studentNo || '',
          initial:    (s.name || s.childName || '?')[0],
          paid,
          incomeId:   paid ? incomeRecord._id : null,
          amountStr:  paid ? Number(incomeRecord.amount).toFixed(2) : '',
          payDate:    paid ? fmtDate(incomeRecord.date) : '',
          payMethod:  paid ? (incomeRecord.payMethod || '') : '',
        }
      })

      const paidCount   = members.filter(m => m.paid).length
      const unpaidCount = Math.max(0, app.globalData.totalStudents - paidCount)

      this.setData({
        _allMembers: members,
        paidCount,
        unpaidCount,
        loading: false,
      })
      this.applyFilter()
    } catch (err) {
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
      console.error(err)
      this.setData({ loading: false })
    }
  },

  // 没有 students 集合时：从 income 中提取已缴名单，剩余用序号占位
  _buildRosterFromIncome(incomeList) {
    const known = []
    const seen = new Set()
    incomeList.forEach(r => {
      const n = r.payer || r.childName
      if (n && !seen.has(n)) { seen.add(n); known.push({ name: n }) }
    })
    const total = this.data.totalStudents
    // 补足未知成员
    for (let i = known.length; i < total; i++) {
      known.push({ name: `待登记成员${i + 1}` })
    }
    return known
  },

  // ─── 导入花名册 ──────────────────────────────
  openImportModal() {
    this.setData({ showImportModal: true, importText: '', importCount: 0, keyboardHeight: 0 })
    wx.onKeyboardHeightChange(res => {
      this.setData({ keyboardHeight: res.height })
    })
  },

  closeImportModal() {
    wx.offKeyboardHeightChange()
    this.setData({ showImportModal: false, keyboardHeight: 0 })
  },

  noop() {},

  onImportTextInput(e) {
    const text = e.detail.value
    const count = text.split('\n').map(parseRosterLine).filter(Boolean).length
    this.setData({ importText: text, importCount: count })
  },

  async doImport() {
    const { importText } = this.data
    const parsed = importText.split('\n').map(parseRosterLine).filter(Boolean)

    if (parsed.length === 0) {
      wx.showToast({ title: '请输入姓名', icon: 'none' }); return
    }

    this.setData({ importing: true })

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'importMembers',
        data: { members: parsed },
      })

      const parts = []
      if (result.added)   parts.push(`新增 ${result.added} 人`)
      if (result.skipped) parts.push(`跳过 ${result.skipped} 人`)

      wx.showModal({
        title: '导入完成',
        content: parts.join('，'),
        showCancel: false,
        confirmText: '好的',
      })
      this.setData({ showImportModal: false })
      this.loadData()
    } catch (err) {
      wx.showToast({ title: '导入失败，请重试', icon: 'none' })
      console.error(err)
    } finally {
      this.setData({ importing: false })
    }
  },

  // ─── 筛选 & 搜索 ─────────────────────────────
  setFilter(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.filter })
    this.applyFilter()
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.applyFilter()
  },

  clearSearch() {
    this.setData({ keyword: '' })
    this.applyFilter()
  },

  applyFilter() {
    const { _allMembers, activeFilter, keyword } = this.data
    let list = _allMembers

    if (activeFilter === 'paid')   list = list.filter(m => m.paid)
    if (activeFilter === 'unpaid') list = list.filter(m => !m.paid)

    if (keyword.trim()) {
      const kw = keyword.trim()
      list = list.filter(m => m.name.includes(kw))
    }

    this.setData({ displayList: list })
  },

  // ─── 长按成员 → 操作菜单（仅主任） ──────────
  onMemberLongPress(e) {
    if (!this.data.isChair) return
    const { id, name, studentno } = e.currentTarget.dataset
    wx.showActionSheet({
      itemList: ['✏️ 修改姓名/学号', '🗑 删除成员'],
      success: res => {
        if (res.tapIndex === 0) this.openEditModal({ id, name, studentNo: studentno })
        if (res.tapIndex === 1) this.confirmDelete({ id, name })
      },
    })
  },

  openEditModal({ id, name, studentNo }) {
    this.setData({
      showEditModal: true,
      editMember: { id, name, studentNo },
      editName: name,
      editStudentNo: studentNo || '',
    })
  },

  closeEditModal() {
    this.setData({ showEditModal: false, editMember: null })
  },

  onEditNameInput(e)      { this.setData({ editName: e.detail.value }) },
  onEditStudentNoInput(e) { this.setData({ editStudentNo: e.detail.value }) },

  async saveEdit() {
    const { editMember, editName, editStudentNo } = this.data
    if (!editName.trim()) {
      wx.showToast({ title: '姓名不能为空', icon: 'none' }); return
    }
    this.setData({ editSaving: true })
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'importMembers',
        data: { action: 'update', memberId: editMember.id, name: editName.trim(), studentNo: editStudentNo.trim() },
      })
      if (!result.success) {
        wx.showToast({ title: result.error || '保存失败', icon: 'none' }); return
      }
      wx.showToast({ title: '已保存', icon: 'success' })
      this.closeEditModal()
      this.loadData()
    } catch (e) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ editSaving: false })
    }
  },

  confirmDelete({ id, name }) {
    if (!id) {
      wx.showToast({ title: '该成员无法删除', icon: 'none' }); return
    }
    wx.showModal({
      title: '删除成员',
      content: `确认删除「${name}」？此操作不可撤销。`,
      confirmText: '删除',
      confirmColor: '#FF4D4F',
      success: async res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        try {
          const { result } = await wx.cloud.callFunction({
            name: 'importMembers',
            data: { action: 'delete', memberId: id },
          })
          if (!result.success) {
            wx.showToast({ title: result.error || '删除失败', icon: 'none' }); return
          }
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadData()
        } catch (e) {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      },
    })
  },

  // ─── Admin 操作 ──────────────────────────────
  // 点击"录入"→ 跳转添加收费页并预填姓名
  markPaid(e) {
    const { name, studentno } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/add/add?type=income&childName=${encodeURIComponent(name)}&studentNo=${encodeURIComponent(studentno || '')}`,
    })
  },

  // 点击"详情"→ 跳转收费记录详情（record 页待实现，先用 navigateTo 占位）
  viewPayment(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/record/record?id=${id}&type=income` })
  },

  // ─── 下拉刷新 ────────────────────────────────
  onPullDownRefresh() {
    this.loadData().then(() => wx.stopPullDownRefresh())
  },
})

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

// 解析花名册一行：支持 "01 张三" / "01张三" / "张三" 三种格式
function parseRosterLine(line) {
  const s = line.trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})\s*(.+)$/)
  if (m) return { studentNo: m[1].padStart(2, '0'), name: m[2].trim() }
  return { studentNo: '', name: s }
}
