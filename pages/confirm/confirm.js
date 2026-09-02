// pages/confirm/confirm.js
const app = getApp()

Page({
  data: {
    paymentList: [],
    loading: true,
  },

  async onShow() {
    await app.waitLogin()
    const role = app.globalData.role
    if (!['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member'].includes(role)) {
      wx.showToast({ title: '无访问权限', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.loadAll()
  },

  async loadAll() {
    this.setData({ loading: true })
    try {
      const yearTerm = app.globalData.yearTerm
      const [pendingResult, fundsResult] = await Promise.all([
        wx.cloud.callFunction({ name: 'getUserList', data: { action: 'getPending', yearTerm } }),
        wx.cloud.callFunction({ name: 'getUserList', data: { action: 'listFunds', yearTerm } }),
      ])

      // 建立 fundId → fundName 映射
      const fundMap = {}
      const funds = fundsResult.result.funds || []
      funds.forEach(f => { fundMap[f._id] = f.name })

      this.setData({
        paymentList: (pendingResult.result.payments || []).map(r => ({
          ...r,
          initial:   (r.childName || r.payerName || '?')[0],
          amountStr: Number(r.amount).toFixed(2),
          timeStr:   fmtTime(r.submittedAt),
          fundName:  r.fundId ? (fundMap[r.fundId] || '专项活动') : '',
        })),
      })
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  // ─── 缴费：单条确认（直接入账，不弹二次确认）──
  confirmOnePayment(e) {
    const { id } = e.currentTarget.dataset
    this.doConfirmPayments([id])
  },

  // ─── 缴费：全部确认 ──────────────────────────
  confirmAllPayments() {
    const count = this.data.paymentList.length
    wx.showModal({
      title: '批量确认',
      content: `确认全部 ${count} 条缴费记录？请确保已核对微信收款记录。`,
      confirmText: '全部确认',
      confirmColor: '#07C160',
      success: res => {
        if (res.confirm) this.doConfirmPayments(this.data.paymentList.map(r => r._id))
      },
    })
  },

  async doConfirmPayments(claimIds) {
    wx.showLoading({ title: '确认中...' })
    try {
      const { result } = await wx.cloud.callFunction({ name: 'confirmFeeSubmission', data: { claimIds } })
      if (!result.success) {
        wx.showToast({ title: result.error || '操作失败', icon: 'none', duration: 3000 })
        return
      }
      const ok     = result.results.filter(r => r.ok).length
      const failed = result.results.filter(r => !r.ok)
      if (failed.length > 0) {
        wx.showToast({ title: `${ok} 条已确认，${failed.length} 条失败`, icon: 'none', duration: 3000 })
      } else {
        wx.showToast({ title: `已确认 ${ok} 条`, icon: 'success' })
      }
      this.loadAll()
    } catch (err) {
      wx.showToast({ title: '网络错误，请重试', icon: 'none' })
      console.error(err)
    } finally {
      wx.hideLoading()
    }
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh())
  },
})

function fmtTime(d) {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}
