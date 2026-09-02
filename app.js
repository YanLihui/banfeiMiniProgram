// app.js
App({
  globalData: {
    userInfo: null,
    openid: null,
    role: 'new',
    childName: '',
    className: '',
    yearTerm: '',
    totalStudents: 0,
    feePerStudent: 0,
  },

  // ─── 角色快捷判断 ────────────────────────────
  // 所有家委成员
  get isCommittee() {
    return ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member'].includes(this.globalData.role)
  },
  // 可操作财务（录入收费、确认缴费、提交报销）
  get isCashier() { return this.globalData.role === 'cashier' },
  // 可审批报销
  get isAccountant() { return this.globalData.role === 'accountant' },
  // 可管理班级设置 / 花名册
  get isChair() { return this.globalData.role === 'chair' },
  // 普通家长（含新用户）
  get isParent() {
    return ['parent', 'new'].includes(this.globalData.role)
  },
  // 可查看应用内容（非无权限）
  get canView() {
    return this.globalData.role !== 'none'
  },

  onLaunch() {
    if (!wx.cloud) {
      wx.showToast({ title: '请更新微信版本', icon: 'none' })
      return
    }
    wx.cloud.init({
      // ⚠️ 替换为你的云开发环境 ID（在微信开发者工具 -> 云开发控制台 -> 环境 ID）
      env: 'cloud1-d0g32b3wn70fb5c10',
      traceUser: true,
    })
    this.checkLogin()
  },

  async checkLogin() {
    // 先用本地缓存让页面快速展示，再后台刷新
    try {
      const cached = wx.getStorageSync('loginCache')
      if (cached && cached.openid) {
        this.globalData.openid    = cached.openid
        this.globalData.role      = cached.role      || 'parent'
        this.globalData.childName = cached.childName || ''
        if (cached.classSettings) {
          const s = cached.classSettings
          if (s.className)     this.globalData.className     = s.className
          if (s.yearTerm)      this.globalData.yearTerm      = s.yearTerm
          if (s.totalStudents) this.globalData.totalStudents = s.totalStudents
          if (s.feePerStudent) this.globalData.feePerStudent = s.feePerStudent
        }
        if (this._loginResolve) this._loginResolve(cached)
        this._loginResolve = null
      }
    } catch (_) {}

    // 无论是否有缓存，都后台刷新一次（最多重试 2 次）
    let lastErr
    for (let i = 0; i < 3; i++) {
      try {
        const { result } = await wx.cloud.callFunction({ name: 'getRole' })
        this.globalData.openid    = result.openid
        this.globalData.role      = result.role
        this.globalData.childName = result.childName || ''
        if (result.classSettings) {
          const s = result.classSettings
          if (s.className)     this.globalData.className     = s.className
          if (s.yearTerm)      this.globalData.yearTerm      = s.yearTerm
          if (s.totalStudents) this.globalData.totalStudents = s.totalStudents
          if (s.feePerStudent) this.globalData.feePerStudent = s.feePerStudent
        }
        // 写入缓存
        wx.setStorageSync('loginCache', {
          openid:       result.openid,
          role:         result.role,
          childName:    result.childName || '',
          classSettings: result.classSettings || null,
        })
        if (this._loginResolve) this._loginResolve(result)
        this._loginResolve = null
        if (result.role === 'chair' && !this.globalData.yearTerm) {
          wx.reLaunch({ url: '/pages/setup/setup' })
        }
        return
      } catch (err) {
        lastErr = err
        console.error(`getRole 第 ${i + 1} 次失败`, err)
        if (i < 2) await new Promise(r => setTimeout(r, 1500))
      }
    }
    // 3 次全失败且没有缓存 → 兜底
    if (!this.globalData.openid) {
      if (this._loginResolve) this._loginResolve({})
      this._loginResolve = null
      wx.showToast({ title: '网络异常，请重启小程序', icon: 'none', duration: 3000 })
    }
  },

  async loadClassSettings() {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('classSettings').limit(10).get()
      const s = res.data.find(r => r.className) || res.data[0]
      if (s) {
        if (s.className)     this.globalData.className     = s.className
        if (s.yearTerm)      this.globalData.yearTerm      = s.yearTerm
        if (s.totalStudents) this.globalData.totalStudents = s.totalStudents
        if (s.feePerStudent) this.globalData.feePerStudent = s.feePerStudent
      }
    } catch (e) { console.error('加载班级设置失败', e) }
  },

  // 页面等待登录完成，10秒超时保底避免永久挂起
  waitLogin() {
    if (this.globalData.openid) return Promise.resolve()
    return new Promise(resolve => {
      this._loginResolve = resolve
      setTimeout(() => {
        if (!this.globalData.openid) {
          this.globalData.openid = 'timeout'
          resolve({})
          wx.showToast({ title: '登录超时，请重启小程序', icon: 'none', duration: 3000 })
        }
      }, 10000)
    })
  },
})
