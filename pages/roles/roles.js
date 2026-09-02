// pages/roles/roles.js
const app = getApp()

const ROLE_OPTIONS = [
  { value: 'chair',           label: '📢 家委发言人' },
  { value: 'cashier',         label: '🔑 司库' },
  { value: 'accountant',      label: '🦉 总会计师' },
  { value: 'artDirector',     label: '🎨 艺术总监' },
  { value: 'planningDirector',label: '🎪 策划总监' },
  { value: 'member',          label: '🐝 家委成员' },
  { value: 'parent',          label: '🌻 成长合伙人' },
]

const ROLE_LABEL = {
  chair:           '📢 家委发言人',
  cashier:         '🔑 司库',
  accountant:      '🦉 总会计师',
  artDirector:     '🎨 艺术总监',
  planningDirector:'🎪 策划总监',
  member:          '🐝 家委成员',
  parent:          '🌻 成长合伙人',
}

Page({
  data: {
    members: [],
    loading: true,
    showRolePicker: false,
    pickerIndex: -1,
    roleOptions: ROLE_OPTIONS,
  },

  async onShow() {
    await app.waitLogin()
    if (!['chair', 'cashier'].includes(app.globalData.role)) {
      wx.showToast({ title: '无访问权限', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.loadMembers()
  },

  async loadMembers() {
    this.setData({ loading: true })
    try {
      // 通过云函数读取（绕过客户端 _openid 权限，可见所有已注册用户）
      const { result } = await wx.cloud.callFunction({ name: 'getUserList' })
      const usersData  = result.users  || []
      const adminsData = result.admins || []

      // openid → admin记录
      const adminMap = {}
      adminsData.forEach(r => { adminMap[r.openid] = r })

      const members = usersData
        .filter(u => u.childName) // 只显示已完成 onboard 的用户
        .map(u => {
          const admin = adminMap[u._openid]
          const role  = admin ? admin.role : 'parent'
          return {
            _id:        u._id,
            openid:     u._openid,
            adminId:    admin ? admin._id : null,
            name:       u.name || '（未填姓名）',
            childName:  u.childName,
            role,
            roleLabel:  ROLE_LABEL[role] || '成长合伙人',
            isCommittee: !!admin,
            initial:    (u.name || u.childName || '?')[0],
          }
        })

      this.setData({ members, loading: false })
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
      console.error(err)
      this.setData({ loading: false })
    }
  },

  // 点击成员 → 打开自定义角色选择面板
  pickRole(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ showRolePicker: true, pickerIndex: index })
  },

  closeRolePicker() {
    this.setData({ showRolePicker: false, pickerIndex: -1 })
  },

  onPickerMaskTap() {
    this.closeRolePicker()
  },

  async selectRole(e) {
    const roleValue = e.currentTarget.dataset.role
    const index = this.data.pickerIndex
    const member = this.data.members[index]
    this.closeRolePicker()
    if (!member || roleValue === member.role) return
    await this.saveRole(index, member, roleValue)
  },

  async saveRole(index, member, newRole) {
    wx.showLoading({ title: '保存中...' })
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getUserList',
        data: {
          action:  'setRole',
          openid:  member.openid,
          newRole,
          adminId: member.adminId || null,
        },
      })
      if (!result.success) {
        wx.showToast({ title: result.error || '保存失败', icon: 'none', duration: 3000 })
        return
      }

      // 更新本地列表
      const members = [...this.data.members]
      members[index] = {
        ...member,
        role:        newRole,
        roleLabel:   ROLE_LABEL[newRole],
        isCommittee: newRole !== 'parent',
        adminId:     result.adminId || member.adminId,
      }
      this.setData({ members })
      wx.showToast({ title: `已设为${ROLE_LABEL[newRole]}`, icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      console.error(err)
    } finally {
      wx.hideLoading()
    }
  },

  onPullDownRefresh() {
    this.loadMembers().then(() => wx.stopPullDownRefresh())
  },
})
