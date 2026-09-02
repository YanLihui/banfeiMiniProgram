// cloudfunctions/confirmClaim/index.js
// 出纳确认一条或多条待缴费申请，写入 income 集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async ({ claimIds }) => {
  const { OPENID } = cloud.getWXContext()
  const db = cloud.database()

  // 权限校验：出纳或家委发言人可确认缴费
  const adminRes = await db.collection('classAdmins')
    .where({ openid: OPENID }).limit(1).get()
  if (adminRes.data.length === 0 || !['cashier', 'chair'].includes(adminRes.data[0].role)) {
    return { success: false, error: '仅出纳或家委发言人可确认缴费' }
  }

  // 读取班级设置，获取标准收费金额
  let feePerStudent = null
  try {
    const settingsRes = await db.collection('classSettings').limit(1).get()
    if (settingsRes.data.length > 0) feePerStudent = settingsRes.data[0].feePerStudent
  } catch (_) {}

  const results = []
  for (const id of claimIds) {
    try {
      const { data: claim } = await db.collection('feeSubmissions').doc(id).get()
      if (claim.status !== 'pending') {
        results.push({ id, ok: false, error: '已处理' })
        continue
      }

      // 校验同学年是否已有 income 记录（防止重复确认）
      // 专项：同一 fundId 下同一 childName 不重复；普通：同一 yearTerm 下不重复
      const dupQuery = claim.fundId
        ? db.collection('incomes').where({ childName: claim.childName, yearTerm: claim.yearTerm, fundId: claim.fundId })
        : db.collection('incomes').where({ childName: claim.childName, yearTerm: claim.yearTerm, fundId: null })
      const dupRes = await dupQuery.limit(1).get()
      if (dupRes.data.length > 0) {
        // 直接把 feeSubmission 标为 approved，不再重复写 income
        await db.collection('feeSubmissions').doc(id).update({
          data: { status: 'approved', confirmedBy: OPENID, confirmedAt: db.serverDate() },
        })
        results.push({ id, ok: true, warn: '已有收费记录，仅更新状态' })
        continue
      }

      // 查花名册取学号
      let studentNo = ''
      try {
        const memberRes = await db.collection('classMembers')
          .where({ name: claim.childName })
          .limit(1).get()
        if (memberRes.data.length > 0) studentNo = memberRes.data[0].studentNo || ''
      } catch (_) {}

      // 写入正式 income 记录（金额以 classSettings 为准，忽略家长提交值）
      const confirmedAmount = (!claim.fundId && feePerStudent) ? feePerStudent : claim.amount
      await db.collection('incomes').add({
        data: {
          fundId:     claim.fundId || null,
          payer:      claim.payerName || claim.childName,
          childName:  claim.childName,
          studentNo,
          amount:     confirmedAmount,
          date:       new Date().toISOString().slice(0, 10),
          payMethod:  '微信转账',
          yearTerm:   claim.yearTerm,
          claimId:    id,
          createdBy:  OPENID,
          createdAt:  db.serverDate(),
        },
      })

      // 更新申请状态
      await db.collection('feeSubmissions').doc(id).update({
        data: {
          status:      'approved',
          confirmedBy: OPENID,
          confirmedAt: db.serverDate(),
        },
      })

      results.push({ id, ok: true })
    } catch (err) {
      results.push({ id, ok: false, error: String(err) })
    }
  }

  return { success: true, results }
}
