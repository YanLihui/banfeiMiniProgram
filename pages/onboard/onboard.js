// pages/onboard/onboard.js
const app = getApp()

Page({
  data: {
    className:      '',
    avatarUrl:      '',
    name:           '',
    submitting:     false,
    claimChair:     false,
    setupCode:      '',
    codeWrong:      false,

    // 花名册 picker
    rosterStudents: [],
    rosterOptions:  [],
    pickerIdx:      0,
    studentNo:      '',
    childName:      '',
    rosterLoaded:   false,
    rosterEmpty:    false,

    // 手动输入模式（花名册为空时）
    childNameManual: '',
    childNoManual:   '',
    notFound:        false,
  },

  async onLoad() {
    wx.setNavigationBarTitle({ title: '加入班级' })
    this.setData({ className: app.globalData.className })
    await this.loadRoster()
  },

  async loadRoster() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'importMembers',
        data: { action: 'list' },
      })
      const raw = result.data || []
      if (raw.length === 0) {
        this.setData({ rosterLoaded: true, rosterEmpty: true })
        return
      }
      const students = raw
        .filter(s => s.name)
        .sort((a, b) => (parseInt(a.studentNo) || 99) - (parseInt(b.studentNo) || 99))
        .map(s => ({ studentNo: s.studentNo || '', name: s.name }))
      const options = students.map(s =>
        `${String(s.studentNo || '--').padStart(2, '0')}  ${s.name}`
      )
      this.setData({ rosterStudents: students, rosterOptions: options, rosterLoaded: true })
    } catch (e) {
      console.error('loadRoster', e)
      this.setData({ rosterLoaded: true, rosterEmpty: true })
    }
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  onNameInput(e) { this.setData({ name: e.detail.value }) },

  onPickerChange(e) {
    const idx = parseInt(e.detail.value)
    const s = this.data.rosterStudents[idx]
    if (!s) return
    this.setData({ pickerIdx: idx, studentNo: s.studentNo, childName: s.name, notFound: false })
  },

  onChildNameManualInput(e) {
    this.setData({ childNameManual: e.detail.value, notFound: false })
  },

  onChildNoManualInput(e) {
    this.setData({ childNoManual: e.detail.value })
  },

  onSetupCodeInput(e) { this.setData({ setupCode: e.detail.value, codeWrong: false }) },

  onClaimChairChange(e) {
    const claimChair = e.detail.value.includes('chair')
    this.setData({ claimChair, setupCode: '', codeWrong: false })
  },

  async submit() {
    const { name, avatarUrl, claimChair, setupCode,
            rosterEmpty, childNameManual, childNoManual, childName, studentNo } = this.data

    const finalChildName = rosterEmpty ? childNameManual.trim() : childName
    const finalStudentNo = rosterEmpty
      ? String(parseInt(childNoManual) || '').padStart(2, '0')
      : studentNo

    // 主任不需要填孩子姓名
    if (!name.trim()) {
      wx.showToast({ title: '请填写家长姓名', icon: 'none' }); return
    }
    if (!claimChair && !finalChildName) {
      wx.showToast({ title: '请选择或填写孩子姓名', icon: 'none' }); return
    }
    if (!claimChair && rosterEmpty && !childNoManual.trim()) {
      wx.showToast({ title: '请填写学号', icon: 'none' }); return
    }
    if (claimChair && !setupCode.trim()) {
      wx.showToast({ title: '请输入家委主任设置码', icon: 'none' }); return
    }

    this.setData({ submitting: true, notFound: false, codeWrong: false })

    try {
      const { result } = await wx.cloud.callFunction({ name: 'getRole' })
      app.globalData.openid = result.openid

      let role = result.role

      if (claimChair && role !== 'chair') {
        const claimRes = await wx.cloud.callFunction({
          name: 'getUserList',
          data: { action: 'claimChair', setupCode: setupCode.trim() },
        })
        if (!claimRes.result.success) {
          this.setData({ codeWrong: true, submitting: false })
          return
        }
        role = 'chair'
      }

      app.globalData.role = role
      const isCommittee = ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member'].includes(role)

      // 普通家长 + 花名册有数据：验证姓名
      if (!isCommittee && !rosterEmpty) {
        const memberRes = await db.collection('classMembers')
          .where({ name: finalChildName }).limit(1).get()
        if (memberRes.data.length === 0) {
          this.setData({ notFound: true, submitting: false })
          return
        }
      }
      // 普通家长 + 花名册为空：直接保存，等主任导入后 getRole 自动核验

      // 写入 / 更新用户信息（通过云函数，服务端校验）
      const profileRes = await wx.cloud.callFunction({
        name: 'getUserList',
        data: {
          action:             'updateUserProfile',
          name:               name.trim(),
          childName:          finalChildName,
          studentNo:          finalStudentNo,
          avatarUrl:          avatarUrl || '',
          skipChildNameCheck: role === 'chair',
        },
      })
      if (!profileRes.result.success) {
        wx.showToast({ title: profileRes.result.error || '保存失败', icon: 'none' }); return
      }

      app.globalData.childName = finalChildName

      // 主任且班级未配置 → 进 setup（用 globalData，classSettings 由 getRole CF 返回，无 _openid 限制）
      if (role === 'chair' && !app.globalData.yearTerm) {
        wx.reLaunch({ url: '/pages/setup/setup' })
        return
      }

      wx.reLaunch({ url: '/pages/index/index' })

    } catch (err) {
      wx.showToast({ title: '网络错误，请重试', icon: 'none' })
      console.error(err)
      this.setData({ submitting: false })
    }
  },
})
