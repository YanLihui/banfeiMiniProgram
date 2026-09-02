// cloudfunctions/getRole/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const COMMITTEE_ROLES = ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member']

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const db = cloud.database()

  // 3 个查询并行，各自加 catch 防止单个失败导致整体崩溃
  const [adminRes, userRes, settingsRes] = await Promise.all([
    db.collection('classAdmins').where({ openid: OPENID }).limit(1).get()
      .catch(() => ({ data: [] })),
    db.collection('users').where({ _openid: OPENID }).limit(1).get()
      .catch(() => ({ data: [] })),
    db.collection('classSettings').limit(10).get()
      .catch(() => ({ data: [] })),
  ])

  // 角色判断
  let role = null
  if (adminRes.data.length > 0) {
    const r = adminRes.data[0].role
    role = COMMITTEE_ROLES.includes(r) ? r : null
  }

  let userRecord = userRes.data[0] || null

  // 没有 users 记录则创建（不等待，异步写入）
  if (!userRecord) {
    db.collection('users').add({
      data: { _openid: OPENID, name: '', childName: '', createdAt: db.serverDate() },
    }).catch(() => {})
  }

  // 非委员：按花名册判断
  if (!role) {
    const childName = userRecord ? userRecord.childName : ''
    if (childName) {
      const memberRes = await db.collection('classMembers')
        .where({ name: childName }).limit(1).get()
      role = memberRes.data.length > 0 ? 'parent' : 'none'
    } else {
      role = 'new'
    }
  }

  // 班级设置（过滤敏感字段 setupCode）
  let classSettings = null
  const rawSettings = settingsRes.data.find(r => r.className) || settingsRes.data[0] || null
  if (rawSettings) {
    const { setupCode, ...safeSettings } = rawSettings
    classSettings = safeSettings
  }

  return {
    openid: OPENID,
    role,
    childName: userRecord ? (userRecord.childName || '') : '',
    classSettings,
  }
}
