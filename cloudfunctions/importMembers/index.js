// cloudfunctions/importMembers/index.js
// action: 'import' — 批量导入花名册
// action: 'list'   — 读取全部花名册（绕过客户端 _openid 权限限制）
// action: 'update' — 修改成员姓名或学号（仅 chair）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const COMMITTEE_ROLES = ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member']

exports.main = async (event) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'import'

  // ── 读取花名册 ─────────────────────────────
  // onboard 时用户尚未写入 users，允许任何已登录微信用户读取花名册
  if (action === 'list') {
    const res = await db.collection('classMembers')
      .orderBy('studentNo', 'asc')
      .limit(200)
      .get()
    return { success: true, data: res.data }
  }

  // ── 修改成员（仅 chair） ───────────────────
  if (action === 'update') {
    const callerRes = await db.collection('classAdmins').where({ openid: OPENID }).limit(1).get()
    const caller = callerRes.data[0]
    if (!caller || caller.role !== 'chair') {
      return { success: false, error: '仅家委主任可修改成员' }
    }
    const { memberId, name, studentNo } = event
    if (!memberId || !name || !name.trim()) return { success: false, error: '参数缺失' }
    await db.collection('classMembers').doc(memberId).update({
      data: { name: name.trim(), studentNo: (studentNo || '').trim() },
    })
    return { success: true }
  }

  // ── 删除成员（仅 chair） ───────────────────
  if (action === 'delete') {
    const callerRes = await db.collection('classAdmins').where({ openid: OPENID }).limit(1).get()
    const caller = callerRes.data[0]
    if (!caller || caller.role !== 'chair') {
      return { success: false, error: '仅家委主任可删除成员' }
    }
    const { memberId } = event
    if (!memberId) return { success: false, error: '参数缺失' }
    await db.collection('classMembers').doc(memberId).remove()
    return { success: true }
  }

  // ── 批量导入 ───────────────────────────────
  const { members } = event  // [{ name, studentNo }]

  if (!Array.isArray(members) || members.length === 0) {
    return { success: false, message: '名单为空' }
  }

  const existingRes = await db.collection('classMembers').limit(200).get()
  const existingNames = new Set(existingRes.data.map(r => r.name))

  const toAdd = []
  const seen = new Set()
  for (const { name, studentNo } of members) {
    if (!name || seen.has(name) || existingNames.has(name)) continue
    seen.add(name)
    toAdd.push({ name, studentNo: studentNo || '' })
  }

  let added = 0
  for (const item of toAdd) {
    await db.collection('classMembers').add({
      data: { ...item, createdAt: db.serverDate() },
    })
    added++
  }

  return {
    success: true,
    added,
    skipped: members.length - toAdd.length,
  }
}
