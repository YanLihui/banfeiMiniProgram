// cloudfunctions/approveExpenseClaim/index.js
// 出纳审批委员报销申请：approve → 写入 expenses；reject → 标记拒绝
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async ({ claimId, action, rejectReason }) => {
  // action: 'approve' | 'reject'
  const { OPENID } = cloud.getWXContext()
  const db = cloud.database()

  // 权限校验
  const adminRes = await db.collection('classAdmins')
    .where({ openid: OPENID }).limit(1).get()
  if (adminRes.data.length === 0) return { success: false, error: '无权限' }

  const { data: claim } = await db.collection('expenseClaims').doc(claimId).get()
  if (claim.status !== 'pending') return { success: false, error: '该申请已处理' }

  if (action === 'approve') {
    // 写入正式支出记录
    await db.collection('expenses').add({
      data: {
        title:         claim.title,
        amount:        claim.amount,
        category:      claim.category,
        date:          claim.date,
        eventName:     claim.eventName  || '',
        notes:         claim.notes      || '',
        receipts:      claim.receipts   || [],
        isPublic:      true,
        claimId,
        submitterName: claim.submitterName || '',
        createdBy:     OPENID,
        createdAt:     db.serverDate(),
      },
    })
    await db.collection('expenseClaims').doc(claimId).update({
      data: {
        status:     'approved',
        approvedBy: OPENID,
        approvedAt: db.serverDate(),
      },
    })
  } else {
    await db.collection('expenseClaims').doc(claimId).update({
      data: {
        status:       'rejected',
        rejectedBy:   OPENID,
        rejectedAt:   db.serverDate(),
        rejectReason: rejectReason || '',
      },
    })
  }

  return { success: true }
}
