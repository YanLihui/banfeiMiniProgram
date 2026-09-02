// pages/record/record.js
const app = getApp()

const CATEGORY_MAP = {
  gift:       { icon: '🎁', label: '礼品' },
  decoration: { icon: '🎨', label: '布置装饰' },
  event:      { icon: '🎉', label: '活动费用' },
  trip:       { icon: '🌳', label: '春游/外出' },
  supplies:   { icon: '📚', label: '文具耗材' },
  food:       { icon: '🍭', label: '食品饮料' },
  other:      { icon: '⭐', label: '其他' },
}

Page({
  data: {
    loading: true,
    isAdmin:     false,
    isCashier:   false,
    reimbursing: false,
    type: '',        // 'expense' | 'income'
    record: {},
    // 展示用
    icon: '',
    title: '',
    amountStr: '',
    badgeLabel: '',
    categoryLabel: '',
    receiptUrls: [],
    voucherUrl: '',   // 报销转账凭证
  },

  async onLoad(options) {
    await app.waitLogin()
    const role = app.globalData.role
    const COMMITTEE = ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member']
    this.setData({
      isAdmin:   COMMITTEE.includes(role),
      isCashier: role === 'cashier',
      type: options.type,
    })
    await this.loadRecord(options.id, options.type)
  },

  async loadRecord(id, type) {
    const db = wx.cloud.database()
    const collection = type === 'expense' ? 'expenses' : 'incomes'

    try {
      const { data } = await db.collection(collection).doc(id).get()

      // 云存储图片转临时链接（通过云函数，避免跨用户权限问题）
      let receiptUrls = []
      if (type === 'expense' && data.receipts && data.receipts.length > 0) {
        try {
          const { result } = await wx.cloud.callFunction({
            name: 'getUserList',
            data: { action: 'getTempUrls', fileList: data.receipts },
          })
          receiptUrls = (result.tempUrls || [])
            .filter(f => f.status === 0 && f.tempFileURL)
            .map(f => f.tempFileURL)
        } catch (e) {
          console.error('getTempUrls failed', e)
        }
      }

      const cat = CATEGORY_MAP[data.category] || CATEGORY_MAP.other
      const amount = Number(data.amount || 0)
      let title, icon, badgeLabel, amountStr

      if (type === 'expense') {
        title      = data.title || '支出记录'
        icon       = cat.icon
        amountStr  = `−¥${fmt(amount)}`
        badgeLabel = cat.label
      } else {
        title      = `${data.childName || data.payer || '未知'} · 学年班费`
        icon       = '💚'
        amountStr  = `+¥${fmt(amount)}`
        badgeLabel = data.payMethod || '微信转账'
      }

      this.setData({
        record: data,
        receiptUrls,
        icon, title, amountStr, badgeLabel,
        categoryLabel: cat.label,
        loading: false,
      })

      // 报销凭证（expense 已报销时加载）
      if (type === 'expense' && data.voucherFileID) {
        wx.cloud.callFunction({
          name: 'getUserList',
          data: { action: 'getTempUrls', fileList: [data.voucherFileID] },
        }).then(({ result }) => {
          const url = result.tempUrls?.[0]?.tempFileURL || ''
          this.setData({ voucherUrl: url })
        }).catch(() => {})
      }
    } catch (err) {
      wx.showToast({ title: '记录不存在或已删除', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  // ─── 预览图片 ────────────────────────────────
  previewImage(e) {
    const index = e.currentTarget.dataset.index
    wx.previewImage({
      current: this.data.receiptUrls[index],
      urls:    this.data.receiptUrls,
    })
  },

  previewVoucher() {
    if (this.data.voucherUrl) {
      wx.previewImage({ current: this.data.voucherUrl, urls: [this.data.voucherUrl] })
    }
  },

  // ─── 出纳标记已报销 ──────────────────────────
  async reimburseTapped() {
    const { record } = this.data
    // 先弹确认框，给出附凭证和直接标记两个选项
    wx.showModal({
      title: '标记已报销',
      content: `确认已向 ${record.advancer || '垫付人'} 完成线下报销？`,
      confirmText: '附凭证',
      cancelText: '直接标记',
      success: async res => {
        if (res.confirm) {
          // 附凭证流程
          this._doReimburseWithVoucher()
        } else if (res.cancel) {
          // 直接标记（无凭证）
          this._doReimburse(null)
        }
      },
    })
  },

  async _doReimburseWithVoucher() {
    let loadingShown = false
    try {
      const mediaRes = await new Promise((resolve, reject) =>
        wx.chooseMedia({
          count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
          success: resolve, fail: reject,
        })
      )
      wx.showLoading({ title: '上传中...' })
      loadingShown = true
      const file = mediaRes.tempFiles[0]
      const ext  = file.tempFilePath.split('.').pop()
      const name = `vouchers/${Date.now()}.${ext}`
      const { fileID } = await wx.cloud.uploadFile({ cloudPath: name, filePath: file.tempFilePath })
      wx.hideLoading()
      loadingShown = false
      const { fileList } = await wx.cloud.getTempFileURL({ fileList: [fileID] })
      this.setData({ voucherUrl: fileList[0]?.tempFileURL || '' })
      await this._doReimburse(fileID)
    } catch (err) {
      if (loadingShown) wx.hideLoading()
      if (err.errMsg && err.errMsg.includes('cancel')) return
      wx.showToast({ title: '上传失败', icon: 'none' })
    }
  },

  async _doReimburse(voucherFileID) {
    this.setData({ reimbursing: true })
    wx.showLoading({ title: '处理中...' })
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: { action: 'reimburseExpense', expenseId: this.data.record._id, voucherFileID },
      })
      if (result.success) {
        this.setData({ 'record.reimbursementStatus': 'reimbursed' })
        wx.showToast({ title: '已标记报销', icon: 'success' })
      } else {
        wx.showToast({ title: result.error || '操作失败', icon: 'none' })
      }
    } catch (err) {
      wx.showToast({ title: '网络错误', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ reimbursing: false })
    }
  },

  // ─── 删除记录 ────────────────────────────────
  deleteRecord() {
    const { type, record } = this.data
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确认吗？',
      confirmText: '删除',
      confirmColor: '#FF4D4F',
      success: async res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        const collection = type === 'expense' ? 'expenses' : 'incomes'
        try {
          // income 由云函数创建，无 _openid，必须走云函数删除
          const { result } = await wx.cloud.callFunction({
            name: 'getUserList',
            data: { action: 'deleteRecord', collection, recordId: record._id },
          })
          if (result.success) {
            wx.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 1000)
          } else {
            wx.showToast({ title: result.error || '删除失败', icon: 'none' })
          }
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' })
          console.error(err)
        } finally {
          wx.hideLoading()
        }
      },
    })
  },
})

function fmt(n) {
  return Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
