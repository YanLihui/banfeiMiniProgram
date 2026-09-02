// pages/setup/setup.js
// 家委主任第一次登录后的班级初始化向导
const app = getApp()

Page({
  data: {
    step: 1,   // 1=班级信息  2=花名册导入

    // Step 1 — 班级基本信息
    className:     '',
    yearTerm:      '',
    totalStudents: '',
    feePerStudent: '',
    saving:        false,

    // Step 2 — 花名册批量导入
    importText:  '',
    importCount: 0,
    importPreview: [],
    importing:   false,
    keyboardHeight: 0,
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '初始化班级' })
    this.setData({
      className:     app.globalData.className || '',
      yearTerm:      app.globalData.yearTerm  || '',
      feePerStudent: String(app.globalData.feePerStudent || 200),
    })
    wx.onKeyboardHeightChange(res => {
      this.setData({ keyboardHeight: res.height })
    })
  },

  onUnload() {
    wx.offKeyboardHeightChange()
  },

  // ─── Step 1 输入 ──────────────────────────────
  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  async saveClassInfo() {
    const { className, yearTerm, totalStudents, feePerStudent } = this.data

    if (!className.trim()) {
      wx.showToast({ title: '请填写班级名称', icon: 'none' }); return
    }
    if (!yearTerm.trim()) {
      wx.showToast({ title: '请填写学年', icon: 'none' }); return
    }
    const total = parseInt(totalStudents)
    if (!total || total <= 0) {
      wx.showToast({ title: '请填写有效的班级人数', icon: 'none' }); return
    }
    const fee = parseFloat(feePerStudent)
    if (!fee || fee <= 0) {
      wx.showToast({ title: '请填写有效的每人班费', icon: 'none' }); return
    }

    this.setData({ saving: true })

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: {
          action:        'updateClassSettings',
          className:     className.trim(),
          yearTerm:      yearTerm.trim(),
          totalStudents: total,
          feePerStudent: fee,
        },
      })
      if (!result.success) {
        wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        this.setData({ saving: false })
        return
      }

      // 更新 globalData
      app.globalData.className     = className.trim()
      app.globalData.yearTerm      = yearTerm.trim()
      app.globalData.totalStudents = total
      app.globalData.feePerStudent = fee

      this.setData({ saving: false, step: 2 })
      wx.setNavigationBarTitle({ title: '导入花名册' })
    } catch (err) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      console.error(err)
      this.setData({ saving: false })
    }
  },

  // ─── Step 2 花名册导入 ────────────────────────
  onImportInput(e) {
    const text = e.detail.value
    const lines = text.split('\n').map(parseRosterLine).filter(Boolean)
    // 去重后取前 200 条预览
    const seen = new Set()
    const preview = []
    lines.forEach(l => {
      if (!seen.has(l.name)) { seen.add(l.name); preview.push(l) }
    })
    this.setData({ importText: text, importCount: preview.length, importPreview: preview.slice(0, 5) })
  },

  async doImport() {
    const { importText } = this.data
    const parsed = importText.split('\n').map(parseRosterLine).filter(Boolean)

    if (parsed.length === 0) {
      wx.showToast({ title: '请输入名单内容', icon: 'none' }); return
    }

    this.setData({ importing: true })

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'importMembers',
        data: { members: parsed },
      })

      wx.showToast({ title: `已导入 ${result.added} 名成员`, icon: 'success' })
      this.setData({ importing: false })

      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1200)
    } catch (err) {
      wx.showToast({ title: '导入失败，请重试', icon: 'none' })
      console.error(err)
      this.setData({ importing: false })
    }
  },

  skipImport() {
    wx.reLaunch({ url: '/pages/index/index' })
  },
})

// 解析一行：支持 "01 张三" / "01张三" / "张三"
function parseRosterLine(line) {
  const s = line.trim()
  if (!s) return null
  const m = s.match(/^(\d{1,3})\s*(.+)$/)
  if (m) return { studentNo: m[1].padStart(2, '0'), name: m[2].trim() }
  return { studentNo: '', name: s }
}
