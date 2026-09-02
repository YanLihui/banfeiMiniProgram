// cloudfunctions/getUserList/index.js
// action: 'list'               — 读取全部用户及角色（仅管理员）
// action: 'setRole'            — 设置某用户角色（仅家委主任）
// action: 'getPending'         — 读取待确认缴费
// action: 'getSummary'         — 首页 / 详情页汇总数据（按学年）; generalOnly=true 过滤专项
// action: 'getStats'           — 个人中心统计数字（按学年）
// action: 'getYearTerms'       — 查询所有有记录的学年列表
// action: 'addExpense'         — 服务端写入支出（含金额/学年校验）
// action: 'deleteRecord'       — 删除收入/支出（仅管理员）
// action: 'reimburseExpense'   — 出纳标记已报销（防重复）
// action: 'createFund'         — 创建专项活动基金（chair/cashier）
// action: 'listFunds'          — 查询当前学年专项列表（所有已登录）
// action: 'getFundSummary'     — 按 fundId 拉取专项收支（所有已登录）
// action: 'addFundExpense'     — 专项支出写入（委员）
// action: 'transferFundBalance'— 专项结余转入班费（出纳）
// action: 'getNotice'         — 读取班级公告
// action: 'setNotice'         — 更新班级公告（chair）
// action: 'getFeeStatus'      — 按 childName 查缴费状态（多家长共享同一状态）
// action: 'deleteFundRecord'   — 删除专项内单条收支（chair/cashier）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 允许的委员角色
const COMMITTEE_ROLES = ['chair', 'cashier', 'accountant', 'artDirector', 'planningDirector', 'member']

// 工具：获取调用者的 admin 记录（无则返回 null）
async function getCallerAdmin(db, openid) {
  const res = await db.collection('classAdmins').where({ openid }).limit(1).get()
  return res.data[0] || null
}

exports.main = async (event) => {
  const db = cloud.database()
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'list'

  // ── 读取用户列表（仅管理员可调用） ──────────────
  if (action === 'list') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller) return { error: '无权限' }
    const [usersRes, adminsRes] = await Promise.all([
      db.collection('users').orderBy('createdAt', 'asc').limit(200).get(),
      db.collection('classAdmins').limit(50).get(),
    ])
    return { users: usersRes.data, admins: adminsRes.data }
  }

  // ── 设置角色（仅家委主任可调用） ─────────────────
  if (action === 'setRole') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || !['chair', 'cashier'].includes(caller.role)) return { success: false, error: '仅家委发言人或出纳可修改角色' }

    const { openid, newRole, adminId } = event
    // 校验 newRole 合法
    const validRoles = [...COMMITTEE_ROLES, 'parent']
    if (!validRoles.includes(newRole)) return { success: false, error: '无效角色' }

    if (newRole === 'parent') {
      if (adminId) await db.collection('classAdmins').doc(adminId).remove()
      return { success: true }
    } else {
      if (adminId) {
        await db.collection('classAdmins').doc(adminId).update({ data: { role: newRole } })
        return { success: true, adminId }
      } else {
        const res = await db.collection('classAdmins').add({ data: { openid, role: newRole } })
        return { success: true, adminId: res._id }
      }
    }
  }

  // ── 读取待处理项（仅委员） ──────────────────────────
  if (action === 'getPending') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller) return { success: false, error: '无权限', payments: [] }
    const { yearTerm } = event
    const paymentsRes = await db.collection('feeSubmissions')
      .where({ status: 'pending', yearTerm })
      .orderBy('submittedAt', 'asc')
      .limit(100)
      .get()
    return { payments: paymentsRes.data }
  }

  // ── 首页汇总数据（需已登录用户）──────────────────
  if (action === 'getSummary') {
    // 验证调用者是已注册用户（非 new/none）
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (userRes.data.length === 0) return { incomes: [], expenses: [] }
    const { yearTerm, generalOnly } = event
    const [incomeRes, expenseRes] = await Promise.all([
      db.collection('incomes').where({ yearTerm }).limit(200).get(),
      db.collection('expenses').where({ yearTerm }).limit(200).get(),
    ])
    // generalOnly=true：过滤掉有 fundId 的专项记录（在内存中过滤，避免 null 查询兼容问题）
    let incomes  = incomeRes.data
    let expenses = expenseRes.data
    if (generalOnly) {
      incomes  = incomes.filter(r => !r.fundId)
      expenses = expenses.filter(r => !r.fundId)
    }
    const byDateDesc = (a, b) => new Date(b.date) - new Date(a.date)
    return {
      incomes,
      expenses,
      recentExpense: expenses.slice().sort(byDateDesc).slice(0, 5),
      recentIncome:  incomes.slice().sort(byDateDesc).slice(0, 5),
    }
  }

  // ── 统计汇总 ──────────────────────────────────
  if (action === 'getStats') {
    const { yearTerm } = event
    const [incomeRes, expenseRes] = await Promise.all([
      db.collection('incomes').where({ yearTerm, isOpeningBalance: db.command.neq(true) }).count(),
      db.collection('expenses').where({ yearTerm }).count(),
    ])
    return { incomeCount: incomeRes.total, expenseCount: expenseRes.total }
  }

  // ── 获取云存储临时链接（云函数有完整存储权限） ────────
  if (action === 'getTempUrls') {
    const { fileList } = event
    if (!Array.isArray(fileList) || fileList.length === 0) return { tempUrls: [] }
    const result = await cloud.getTempFileURL({ fileList })
    return { tempUrls: result.fileList.map(f => ({ fileID: f.fileID, tempFileURL: f.tempFileURL, status: f.status })) }
  }

  // ── 更新用户资料（服务端长度/内容校验） ──────────────
  if (action === 'updateUserProfile') {
    const { name, childName, studentNo, avatarUrl, skipChildNameCheck } = event
    if (!skipChildNameCheck && (!childName || typeof childName !== 'string' || !childName.trim())) {
      return { success: false, error: '孩子姓名不能为空' }
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: '家长姓名不能为空' }
    }
    const userData = {
      name:      (name || '').trim().slice(0, 30),
      childName: (childName || '').trim().slice(0, 30),
      studentNo: (studentNo || '').trim().slice(0, 10),
      avatarUrl: (avatarUrl || '').slice(0, 500),
    }
    const existing = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (existing.data.length > 0) {
      await db.collection('users').doc(existing.data[0]._id).update({ data: userData })
    } else {
      await db.collection('users').add({ data: { ...userData, createdAt: db.serverDate() } })
    }
    return { success: true }
  }

  // ── 家长提交缴费申请 ──────────────────────────────
  if (action === 'submitFeeClaim') {
    const { yearTerm } = event

    // 从 users 集合读取调用者信息（包含 childName）
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (userRes.data.length === 0) return { success: false, error: '请先完成注册' }
    const user = userRes.data[0]
    if (!user.childName) return { success: false, error: '请先绑定孩子姓名' }
    if (!yearTerm) return { success: false, error: '学年不能为空' }

    // 从 classSettings 读取标准收费金额（不信任客户端传入的金额）
    const settingsRes = await db.collection('classSettings').limit(1).get()
    const settings = settingsRes.data.find(r => r.className) || settingsRes.data[0]
    if (!settings) return { success: false, error: '班级设置未初始化' }
    const amount = settings.feePerStudent

    // 防重复（按 childName 查，云函数写入无 _openid）
    const existing = await db.collection('feeSubmissions')
      .where({ childName: user.childName, yearTerm }).limit(1).get()
    if (existing.data.length > 0) {
      const status = existing.data[0].status
      return { success: false, duplicate: true, status }
    }

    await db.collection('feeSubmissions').add({
      data: {
        payerName:   (user.name || '').slice(0, 30),
        childName:   user.childName.slice(0, 30),
        amount,
        yearTerm,
        status:      'pending',
        submittedAt: db.serverDate(),
      },
    })
    return { success: true }
  }

  // ── 更新班级设置（仅 chair） ──────────────────────
  if (action === 'updateClassSettings') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || caller.role !== 'chair') {
      return { success: false, error: '仅家委主任可修改班级设置' }
    }
    const { className, yearTerm, totalStudents, feePerStudent } = event
    if (!className || typeof className !== 'string' || !className.trim()) {
      return { success: false, error: '班级名称不能为空' }
    }
    if (!yearTerm || typeof yearTerm !== 'string' || !yearTerm.trim()) {
      return { success: false, error: '学年不能为空' }
    }
    const updateData = {
      className:     className.trim().slice(0, 50),
      yearTerm:      yearTerm.trim().slice(0, 20),
    }
    if (totalStudents) updateData.totalStudents = parseInt(totalStudents)
    if (feePerStudent) updateData.feePerStudent = parseFloat(feePerStudent)

    const existing = await db.collection('classSettings').limit(1).get()
    if (existing.data.length > 0) {
      await db.collection('classSettings').doc(existing.data[0]._id).update({ data: updateData })
    } else {
      await db.collection('classSettings').add({ data: updateData })
    }
    return { success: true }
  }

  // ── 出纳录入收费（服务端校验） ──────────────────────
  if (action === 'addIncome') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || caller.role !== 'cashier') {
      return { success: false, error: '仅出纳可录入收费' }
    }
    const { fundId, studentNo, childName, payerName, amount, date, payMethod, notes, yearTerm } = event
    if (!childName || typeof childName !== 'string' || !childName.trim()) {
      return { success: false, error: '学生姓名不能为空' }
    }
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0 || amt > 999999) return { success: false, error: '金额无效' }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: '日期格式无效' }
    if (!yearTerm) return { success: false, error: '学年不能为空' }

    await db.collection('incomes').add({
      data: {
        fundId:    fundId || null,
        studentNo: (studentNo || '').slice(0, 10),
        payer:     childName.trim().slice(0, 30),
        childName: childName.trim().slice(0, 30),
        payerName: (payerName || '').slice(0, 30),
        amount:    amt,
        date,
        payMethod: (payMethod || '微信转账').slice(0, 20),
        notes:     (notes || '').slice(0, 200),
        yearTerm,
        createdBy: OPENID,
        createdAt: db.serverDate(),
      },
    })
    return { success: true }
  }

  // ── 服务端添加支出（含校验） ──────────────────────
  if (action === 'addExpense') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || !COMMITTEE_ROLES.includes(caller.role)) return { success: false, error: '无权限' }

    const { title, amount, category, date, eventName, notes, isPublic,
            receipts, advancer, yearTerm } = event

    // 服务端校验
    if (!title || typeof title !== 'string' || !title.trim()) return { success: false, error: '事项名称不能为空' }
    if (!advancer || typeof advancer !== 'string' || !advancer.trim()) return { success: false, error: '垫付人不能为空' }
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0 || amt > 999999) return { success: false, error: '金额无效' }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: '日期格式无效' }

    // 校验 yearTerm 与 classSettings 一致
    const settingsRes = await db.collection('classSettings').limit(1).get()
    const validYearTerms = settingsRes.data.map(s => s.yearTerm)
    if (!validYearTerms.includes(yearTerm)) return { success: false, error: '学年与班级设置不符' }

    const VALID_CATEGORIES = ['gift', 'decoration', 'event', 'trip', 'supplies', 'food', 'other']
    const safeCategory = VALID_CATEGORIES.includes(category) ? category : 'other'

    await db.collection('expenses').add({
      data: {
        title:               title.trim().slice(0, 100),
        amount:              amt,
        category:            safeCategory,
        date,
        eventName:           (eventName || '').slice(0, 50),
        notes:               (notes || '').slice(0, 200),
        isPublic:            !!isPublic,
        receipts:            Array.isArray(receipts) ? receipts.slice(0, 6) : [],
        advancer:            advancer.trim().slice(0, 30),
        reimbursementStatus: 'unreimbursed',
        yearTerm,
        createdBy:           OPENID,
        createdAt:           db.serverDate(),
      },
    })
    return { success: true }
  }

  // ── 删除记录（仅管理员） ──────────────────────────
  if (action === 'deleteRecord') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller) return { success: false, error: '无权限' }
    const { collection, recordId } = event
    const allowed = ['incomes', 'expenses']
    if (!allowed.includes(collection)) return { success: false, error: '不允许的集合' }

    if (collection === 'incomes') {
      try {
        const { data: income } = await db.collection('incomes').doc(recordId).get()
        if (income.claimId) {
          await db.collection('feeSubmissions').doc(income.claimId).remove()
        }
      } catch (_) {}
    }
    await db.collection(collection).doc(recordId).remove()
    return { success: true }
  }

  // ── 出纳报销：标记支出为已报销（防重复） ──────────
  if (action === 'reimburseExpense') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || caller.role !== 'cashier') return { success: false, error: '仅出纳可操作' }

    const { expenseId, voucherFileID } = event
    if (!expenseId) return { success: false, error: '参数缺失' }

    // 防重复：先读取当前状态
    const { data: expense } = await db.collection('expenses').doc(expenseId).get()
    if (expense.reimbursementStatus === 'reimbursed') {
      return { success: false, error: '该支出已报销，请勿重复操作' }
    }

    const updateData = {
      reimbursementStatus: 'reimbursed',
      reimbursedBy:        OPENID,
      reimbursedAt:        db.serverDate(),
    }
    if (voucherFileID) updateData.voucherFileID = voucherFileID
    await db.collection('expenses').doc(expenseId).update({ data: updateData })
    return { success: true }
  }

  // ── 查询所有学年 ──────────────────────────────
  if (action === 'getYearTerms') {
    const [incomeRes, expenseRes] = await Promise.all([
      db.collection('incomes').field({ yearTerm: true }).limit(500).get(),
      db.collection('expenses').field({ yearTerm: true }).limit(500).get(),
    ])
    const set = new Set()
    incomeRes.data.forEach(r => r.yearTerm && set.add(r.yearTerm))
    expenseRes.data.forEach(r => r.yearTerm && set.add(r.yearTerm))
    const yearTerms = [...set].sort().reverse()
    return { yearTerms }
  }

  // ── 创建专项活动基金（chair/cashier） ────────────
  if (action === 'createFund') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || !['chair', 'cashier'].includes(caller.role)) {
      return { success: false, error: '仅家委主任或出纳可创建专项' }
    }
    const { name, description, feePerStudent, yearTerm } = event
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: '活动名称不能为空' }
    }
    const fee = parseFloat(feePerStudent)
    if (isNaN(fee) || fee <= 0 || fee > 999999) {
      return { success: false, error: '每人金额无效' }
    }
    if (!yearTerm || typeof yearTerm !== 'string' || !yearTerm.trim()) {
      return { success: false, error: '学年不能为空' }
    }
    const res = await db.collection('specialFunds').add({
      data: {
        name:                  name.trim().slice(0, 50),
        description:           (description || '').slice(0, 200),
        feePerStudent:         fee,
        yearTerm,
        status:                'active',
        createdBy:             OPENID,
        createdAt:             db.serverDate(),
        transferredToGeneral:  false,
        transferAmount:        null,
        transferDate:          null,
        transferBy:            null,
      },
    })
    return { success: true, fundId: res._id }
  }

  // ── 查询专项列表（所有已登录） ────────────────────
  if (action === 'listFunds') {
    const { yearTerm } = event
    try {
      const res = await db.collection('specialFunds')
        .where({ yearTerm })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      return { funds: res.data }
    } catch (_) {
      // 集合尚未创建（还没有任何专项），返回空列表
      return { funds: [] }
    }
  }

  // ── 专项收支汇总（所有已登录） ────────────────────
  if (action === 'getFundSummary') {
    const { fundId } = event
    if (!fundId) return { success: false, error: '参数缺失' }
    try {
      const [incomeRes, expenseRes, fundRes] = await Promise.all([
        db.collection('incomes').where({ fundId }).limit(200).get(),
        db.collection('expenses').where({ fundId }).limit(200).get(),
        db.collection('specialFunds').doc(fundId).get(),
      ])
      return {
        fund:     fundRes.data,
        incomes:  incomeRes.data,
        expenses: expenseRes.data,
      }
    } catch (_) {
      return { success: false, error: '专项不存在' }
    }
  }

  // ── 专项支出写入（委员） ──────────────────────────
  if (action === 'addFundExpense') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || !COMMITTEE_ROLES.includes(caller.role)) {
      return { success: false, error: '无权限' }
    }
    const { fundId, title, amount, category, date, notes, receipts, advancer } = event
    if (!fundId) return { success: false, error: '专项 ID 不能为空' }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return { success: false, error: '事项名称不能为空' }
    }
    if (!advancer || typeof advancer !== 'string' || !advancer.trim()) {
      return { success: false, error: '垫付人不能为空' }
    }
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0 || amt > 999999) return { success: false, error: '金额无效' }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: '日期格式无效' }

    // 验证专项存在且 active
    let fund
    try {
      const { data } = await db.collection('specialFunds').doc(fundId).get()
      fund = data
    } catch (_) {
      return { success: false, error: '专项不存在' }
    }
    if (fund.status !== 'active') return { success: false, error: '专项已关闭' }

    const VALID_CATEGORIES = ['gift', 'decoration', 'event', 'trip', 'supplies', 'food', 'other']
    const safeCategory = VALID_CATEGORIES.includes(category) ? category : 'other'

    await db.collection('expenses').add({
      data: {
        fundId,
        title:               title.trim().slice(0, 100),
        amount:              amt,
        category:            safeCategory,
        date,
        notes:               (notes || '').slice(0, 200),
        isPublic:            true,
        receipts:            Array.isArray(receipts) ? receipts.slice(0, 6) : [],
        advancer:            advancer.trim().slice(0, 30),
        reimbursementStatus: 'unreimbursed',
        yearTerm:            fund.yearTerm,
        createdBy:           OPENID,
        createdAt:           db.serverDate(),
      },
    })
    return { success: true }
  }

  // ── 专项结余转入班费（出纳，幂等） ─────────────────
  if (action === 'transferFundBalance') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || caller.role !== 'cashier') {
      return { success: false, error: '仅出纳可操作' }
    }
    const { fundId } = event
    if (!fundId) return { success: false, error: '参数缺失' }

    let fund
    try {
      const { data } = await db.collection('specialFunds').doc(fundId).get()
      fund = data
    } catch (_) {
      return { success: false, error: '专项不存在' }
    }

    // 幂等检查
    if (fund.transferredToGeneral) {
      return { success: false, error: '结余已转入班费，请勿重复操作' }
    }
    if (fund.status === 'closed') {
      return { success: false, error: '专项已关闭' }
    }

    // 计算结余
    const [incomeRes, expenseRes] = await Promise.all([
      db.collection('incomes').where({ fundId }).limit(200).get(),
      db.collection('expenses').where({ fundId }).limit(200).get(),
    ])
    const totalIncome  = incomeRes.data.reduce((s, r) => s + (r.amount || 0), 0)
    const totalExpense = expenseRes.data.reduce((s, r) => s + (r.amount || 0), 0)
    const balance = totalIncome - totalExpense

    if (balance <= 0) return { success: false, error: '无可转入的结余' }

    const today = new Date().toISOString().slice(0, 10)
    const fundName = fund.name

    // 双分录：专项写一条支出（资金流出），班费写一条收入（资金流入）
    await Promise.all([
      db.collection('expenses').add({
        data: {
          fundId,
          title:               `${fundName} 结余转出`,
          amount:              balance,
          category:            'other',
          date:                today,
          notes:               '结余转入班费',
          isPublic:            true,
          receipts:            [],
          advancer:            '',
          reimbursementStatus: 'reimbursed',
          yearTerm:            fund.yearTerm,
          createdBy:           OPENID,
          createdAt:           db.serverDate(),
        },
      }),
      db.collection('incomes').add({
        data: {
          fundId:    null,  // 归入班费（普通收入）
          childName: `${fundName} 结余转入`,
          payer:     `${fundName} 结余转入`,
          amount:    balance,
          date:      today,
          payMethod: 'transfer',
          notes:     `来自专项活动「${fundName}」结余`,
          yearTerm:  fund.yearTerm,
          createdBy: OPENID,
          createdAt: db.serverDate(),
        },
      }),
    ])

    // 关闭专项，记录转账信息
    await db.collection('specialFunds').doc(fundId).update({
      data: {
        status:               'closed',
        transferredToGeneral: true,
        transferAmount:       balance,
        transferDate:         today,
        transferBy:           OPENID,
      },
    })

    return { success: true, transferAmount: balance }
  }

  // ── 读取班级公告 ──────────────────────────────
  if (action === 'getNotice') {
    const settingsRes = await db.collection('classSettings').limit(10).get()
    const settings = settingsRes.data.find(r => r.className) || settingsRes.data[0]
    return { notice: settings?.notice || '' }
  }

  // ── 更新班级公告（仅 chair） ──────────────────
  if (action === 'setNotice') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || caller.role !== 'chair') {
      return { success: false, error: '仅家委主任可修改公告' }
    }
    const { notice } = event
    const settingsRes = await db.collection('classSettings').limit(10).get()
    const settings = settingsRes.data.find(r => r.className) || settingsRes.data[0]
    if (!settings) return { success: false, error: '班级未初始化' }
    await db.collection('classSettings').doc(settings._id).update({
      data: { notice: (notice || '').trim().slice(0, 200) },
    })
    return { success: true }
  }

  // ── 查询孩子缴费状态（多家长共享，按 childName+yearTerm） ──
  if (action === 'getFeeStatus') {
    const { yearTerm } = event
    if (!yearTerm) return { status: 'unpaid' }

    // 验证调用者身份，只能查自己孩子的缴费状态
    const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (userRes.data.length === 0) return { status: 'unpaid' }
    const childName = userRes.data[0].childName
    if (!childName) return { status: 'unpaid' }

    // 先查 incomes（出纳直接录入的情况）
    const incomeRes = await db.collection('incomes')
      .where({ childName, yearTerm })
      .limit(1).get()
    if (incomeRes.data.length > 0) return { status: 'paid' }

    // 再查 feeSubmissions（家长自己提交的情况）
    const subRes = await db.collection('feeSubmissions')
      .where({ childName, yearTerm })
      .orderBy('submittedAt', 'desc')
      .limit(1).get()
    if (subRes.data.length > 0) {
      const s = subRes.data[0].status
      return { status: s === 'approved' ? 'paid' : 'pending', submissionId: subRes.data[0]._id }
    }
    return { status: 'unpaid' }
  }

  // ── 验证设置码，成功则写入 chair 角色 ─────────────
  if (action === 'claimChair') {
    const { setupCode } = event
    if (!setupCode) return { success: false, error: '设置码不能为空' }

    const settingsRes = await db.collection('classSettings').limit(1).get()
    const storedCode = settingsRes.data[0]?.setupCode || ''

    if (!storedCode || setupCode.trim() !== storedCode) {
      return { success: false, error: '设置码不正确' }
    }

    // 检查是否已经是 chair
    const existingRes = await db.collection('classAdmins')
      .where({ openid: OPENID }).limit(1).get()
    if (existingRes.data.length > 0) {
      await db.collection('classAdmins').doc(existingRes.data[0]._id).update({
        data: { role: 'chair' },
      })
    } else {
      await db.collection('classAdmins').add({
        data: { openid: OPENID, role: 'chair' },
      })
    }
    return { success: true }
  }

  // ── 删除专项活动（chair/cashier，级联删除收支） ────────
  if (action === 'deleteFund') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || !['chair', 'cashier'].includes(caller.role)) {
      return { success: false, error: '仅家委主任或出纳可删除专项' }
    }
    const { fundId } = event
    if (!fundId) return { success: false, error: '参数缺失' }

    // 级联删除该专项下所有收入和支出
    const [incRes, expRes] = await Promise.all([
      db.collection('incomes').where({ fundId }).limit(200).get(),
      db.collection('expenses').where({ fundId }).limit(200).get(),
    ])
    await Promise.all([
      ...incRes.data.map(r => db.collection('incomes').doc(r._id).remove()),
      ...expRes.data.map(r => db.collection('expenses').doc(r._id).remove()),
    ])
    await db.collection('specialFunds').doc(fundId).remove()
    return { success: true }
  }

  // ── 删除专项内单条收支（chair/cashier） ────────────────
  if (action === 'deleteFundRecord') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || !['chair', 'cashier'].includes(caller.role)) {
      return { success: false, error: '仅家委主任或出纳可删除记录' }
    }
    const { recordId, recordType } = event
    if (!recordId || !recordType) return { success: false, error: '参数缺失' }
    const coll = recordType === 'income' ? 'incomes' : 'expenses'
    await db.collection(coll).doc(recordId).remove()
    return { success: true }
  }

  // ── 设置期初结余（仅出纳） ────────────────────────
  if (action === 'setOpeningBalance') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || !['cashier', 'chair'].includes(caller.role)) {
      return { success: false, error: '仅出纳或家委发言人可设置期初结余' }
    }
    const { amount, notes, yearTerm } = event
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0 || amt > 9999999) {
      return { success: false, error: '金额无效' }
    }
    if (!yearTerm) return { success: false, error: '学年不能为空' }

    // 防重复
    const existing = await db.collection('incomes')
      .where({ yearTerm, isOpeningBalance: true }).limit(1).get()
    if (existing.data.length > 0) {
      return { success: false, error: '本学年已设置期初结余，如需修改请先删除原记录' }
    }

    const today = new Date().toISOString().slice(0, 10)
    await db.collection('incomes').add({
      data: {
        fundId:           null,
        childName:        '期初结余',
        payer:            '期初结余',
        amount:           amt,
        date:             today,
        payMethod:        '结转',
        notes:            (notes || '上期班费结余转入').slice(0, 100),
        yearTerm,
        isOpeningBalance: true,
        createdBy:        OPENID,
        createdAt:        db.serverDate(),
      },
    })
    return { success: true }
  }

  // ── 批量清空集合（仅 chair，开发维护用） ──────────
  if (action === 'clearCollection') {
    const caller = await getCallerAdmin(db, OPENID)
    if (!caller || caller.role !== 'chair') return { success: false, error: '仅家委主任可执行此操作' }
    const { collectionName } = event
    const allowed = ['classMembers', 'incomes', 'expenses', 'feeSubmissions', 'specialFunds', 'users']
    if (!allowed.includes(collectionName)) return { success: false, error: '不允许的集合' }
    let total = 0
    while (true) {
      const res = await db.collection(collectionName).limit(20).get()
      if (res.data.length === 0) break
      await Promise.all(res.data.map(r => db.collection(collectionName).doc(r._id).remove()))
      total += res.data.length
    }
    return { success: true, deleted: total }
  }

  return { error: 'unknown action' }
}

