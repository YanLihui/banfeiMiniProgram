// pages/add/add.js
const app = getApp()

Page({
  data: {
    type: 'expense',   // 'expense' | 'income'
    submitting: false,
    showDatePicker: false,
    // 专项基金（从 URL 参数传入）
    fundId: '',
    fundName: '',
    // 学生列表（收费用）
    students: [],
    studentOptions: [],
    studentPickerIdx: 0,
    categories: [
      { value: 'gift',       icon: '🎁', label: '礼品' },
      { value: 'decoration', icon: '🎨', label: '布置装饰' },
      { value: 'event',      icon: '🎉', label: '活动费用' },
      { value: 'trip',       icon: '🌳', label: '春游/外出' },
      { value: 'supplies',   icon: '📚', label: '文具耗材' },
      { value: 'food',       icon: '🍭', label: '食品饮料' },
      { value: 'other',      icon: '⭐', label: '其他' },
    ],
    form: {
      amount: '',
      // 支出字段
      title: '',
      category: 'gift',
      date: '',
      eventName: '',
      notes: '',
      isPublic: true,
      advancer: '',          // 垫付人姓名
      receipts: [],          // 云存储 fileID 数组
      receiptPreviews: [],   // 本地预览 URL 数组
      // 收费字段
      studentNo: '',
      childName: '',
      payer: '',
      payMethod: '微信转账',
    },
  },

  onLoad(options) {
    // 权限检查：所有家委成员可添加支出；出纳可录入收费
    const role = app.globalData.role
    const canExpense = ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member'].includes(role)
    const canIncome  = role === 'cashier'
    if (!canExpense) {
      wx.showToast({ title: '无操作权限', icon: 'none' })
      // setTimeout 避免在 onLoad 期间直接 navigateBack 损坏页面栈
      setTimeout(() => wx.navigateBack(), 300)
      return
    }
    this._canIncome = canIncome
    // 允许从首页携带 type 参数
    if (options.type) this.setData({ type: options.type })
    // 专项基金参数
    if (options.fundId)   this.setData({ fundId: options.fundId })
    if (options.fundName) this.setData({ fundName: decodeURIComponent(options.fundName) })
    // 从成员页带入的预填信息
    if (options.childName) this.setData({ 'form.childName': decodeURIComponent(options.childName) })
    if (options.studentNo) this.setData({ 'form.studentNo': decodeURIComponent(options.studentNo) })
    // 默认日期为今天
    const today = new Date()
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
    this.setData({ 'form.date': dateStr })

    // 预填垫付人为当前用户姓名
    const db = wx.cloud.database()
    db.collection('users').where({ _openid: app.globalData.openid }).limit(1).get()
      .then(res => {
        const myName = res.data[0]?.name || ''
        if (myName) this.setData({ 'form.advancer': myName })
      }).catch(() => {})

    // 收费模式：加载学生列表
    if (this.data.type === 'income') this.loadStudents()
  },

  async loadStudents() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'importMembers',
        data: { action: 'list' },
      })
      const raw = result.data || []
      const students = raw
        .filter(s => s.name || s.childName)
        .sort((a, b) => {
          const na = parseInt(a.studentNo) || 99
          const nb = parseInt(b.studentNo) || 99
          return na - nb
        })
        .map(s => ({
          studentNo: s.studentNo || '',
          childName: s.name || s.childName || '',
        }))
      const studentOptions = students.map(s =>
        `${String(s.studentNo || '--').padStart(2, '0')}  ${s.childName}`
      )
      this.setData({ students, studentOptions })
      // 若 onLoad 已预填 childName（从成员页跳来），对齐 picker 索引
      const preChild = this.data.form.childName
      if (preChild) {
        const idx = students.findIndex(s => s.childName === preChild)
        if (idx >= 0) this.setData({ studentPickerIdx: idx })
      }
    } catch (e) {
      console.error('loadStudents', e)
    }
  },

  onStudentPick(e) {
    const idx = parseInt(e.detail.value)
    const s = this.data.students[idx]
    if (!s) return
    this.setData({
      studentPickerIdx: idx,
      'form.studentNo': s.studentNo || '',
      'form.childName': s.childName,
    })
  },

  setType(e) {
    const t = e.currentTarget.dataset.type
    if (t === 'income' && !this._canIncome) {
      wx.showToast({ title: '仅出纳可录入收费', icon: 'none' })
      return
    }
    this.setData({ type: t })
    if (t === 'income' && this.data.students.length === 0) this.loadStudents()
  },

  onAmountInput(e) {
    this.setData({ 'form.amount': e.detail.value })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  selectCategory(e) {
    this.setData({ 'form.category': e.currentTarget.dataset.val })
  },

  pickDate() {
    // 使用 wx.showActionSheet 或 picker 选日期
    wx.showToast({ title: '请在表单行点击日期选择器', icon: 'none' })
  },

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value })
  },

  pickEvent() {
    // 可扩展为从 events 集合选择活动
    wx.showActionSheet({
      itemList: ['开学典礼', '六一儿童节', '元旦联欢会', '春游', '运动会', '其他'],
      success: res => {
        const items = ['开学典礼', '六一儿童节', '元旦联欢会', '春游', '运动会', '其他']
        this.setData({ 'form.eventName': items[res.tapIndex] })
      },
    })
  },

  pickPayMethod() {
    wx.showActionSheet({
      itemList: ['微信转账', '支付宝转账', '现金'],
      success: res => {
        const methods = ['微信转账', '支付宝转账', '现金']
        this.setData({ 'form.payMethod': methods[res.tapIndex] })
      },
    })
  },

  onPublicChange(e) {
    this.setData({ 'form.isPublic': e.detail.value })
  },

  // ─── 图片上传 ────────────────────────────────
  async addReceipt() {
    const res = await new Promise((resolve, reject) =>
      wx.chooseMedia({
        count: 6 - this.data.form.receipts.length,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: resolve,
        fail: reject,
      })
    )

    wx.showLoading({ title: '上传中...' })
    try {
      for (const file of res.tempFiles) {
        const ext  = file.tempFilePath.split('.').pop()
        const name = `receipts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const uploadRes = await wx.cloud.uploadFile({ cloudPath: name, filePath: file.tempFilePath })

        this.setData({
          'form.receipts':        [...this.data.form.receipts, uploadRes.fileID],
          'form.receiptPreviews': [...this.data.form.receiptPreviews, file.tempFilePath],
        })
      }
    } finally {
      wx.hideLoading()
    }
  },

  previewImage(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.url,
      urls: this.data.form.receiptPreviews,
    })
  },

  removeReceipt(e) {
    const idx = e.currentTarget.dataset.index
    const receipts = [...this.data.form.receipts]
    const previews = [...this.data.form.receiptPreviews]
    receipts.splice(idx, 1)
    previews.splice(idx, 1)
    this.setData({ 'form.receipts': receipts, 'form.receiptPreviews': previews })
  },

  // ─── 表单提交 ────────────────────────────────
  async submit() {
    const { type, form, fundId } = this.data

    // 确保登录完成、yearTerm 已从 classSettings 加载
    const app = getApp()
    await app.waitLogin()

    const yearTerm = app.globalData.yearTerm
    if (!yearTerm) {
      return wx.showToast({ title: '班级信息未加载，请重试', icon: 'none' })
    }

    // 校验
    if (!form.amount || parseFloat(form.amount) <= 0) {
      return wx.showToast({ title: '请输入金额', icon: 'none' })
    }
    if (type === 'expense' && !form.title) {
      return wx.showToast({ title: '请填写事项名称', icon: 'none' })
    }
    if (type === 'expense' && !form.advancer) {
      return wx.showToast({ title: '请填写垫付人', icon: 'none' })
    }
    if (type === 'income' && !form.childName) {
      return wx.showToast({ title: '请填写学生姓名', icon: 'none' })
    }

    this.setData({ submitting: true })
    const db = wx.cloud.database()

    try {
      if (type === 'expense') {
        // 专项支出走 addFundExpense；普通支出走 addExpense
        const action = fundId ? 'addFundExpense' : 'addExpense'
        const payload = {
          action,
          title:     form.title,
          amount:    parseFloat(form.amount),
          category:  form.category,
          date:      form.date,
          notes:     form.notes,
          receipts:  form.receipts,
          advancer:  form.advancer,
        }
        if (fundId) {
          payload.fundId = fundId
        } else {
          payload.eventName = form.eventName
          payload.isPublic  = form.isPublic
          payload.yearTerm  = yearTerm
        }
        const { result } = await wx.cloud.callFunction({ name: 'getUserList', data: payload })
        if (!result.success) {
          return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        }
      } else {
        // income 通过云函数写入，服务端校验角色和数据
        const { result } = await wx.cloud.callFunction({
          name: 'getUserList',
          data: {
            action:    'addIncome',
            fundId:    this.data.fundId || null,
            studentNo: form.studentNo,
            childName: form.childName,
            payerName: form.payer,
            amount:    parseFloat(form.amount),
            date:      form.date,
            payMethod: form.payMethod,
            notes:     form.notes,
            yearTerm,
          },
        })
        if (!result.success) {
          return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        }
      }

      wx.showToast({ title: '保存成功', icon: 'success' })
      // 若是专项页跳转来的，通知 detail 页刷新
      if (this.data.fundId) app.globalData._refreshFundId = this.data.fundId
      setTimeout(() => wx.navigateBack(), 1000)
    } catch (err) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      console.error(err)
    } finally {
      this.setData({ submitting: false })
    }
  },
})
