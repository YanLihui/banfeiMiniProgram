# 班费管理小程序

23级三班班费收支管理微信小程序，基于微信云开发，支持多角色权限、学期隔离、收支记录、报销审批。

---

## 技术栈

- **平台**：微信小程序（WXML / WXSS / JS）
- **后端**：微信云开发（CloudDB + CloudStorage + CloudFunction）
- **云环境 ID**：`cloud1-d0g32b3wn70fb5c10`
- **AppID**：`wxd3c793c3be52874a`
- **wx-server-sdk**：~2.6.3

---

## 角色权限

系统共五种角色，由 `getRole` 云函数在登录时自动识别：

| 角色 | 标识 | 来源 | 权限说明 |
|------|------|------|---------|
| 家委主任 | `chair` | `classAdmins.role = 'chair'` | 全部权限：花名册导入、角色管理、班级设置、账目报告、开启新学期 |
| 出纳 | `cashier` | `classAdmins.role = 'cashier'` | 录入收费、添加支出、提交报销、确认缴费 |
| 会计 | `accountant` | `classAdmins.role = 'accountant'` | 审批报销、本期账目报告、开启新学期 |
| 普通家长 | `parent` | 孩子姓名在花名册中 | 查看收支、提交缴费登记 |
| 无权限 | `none` | 孩子姓名不在花名册 | 仅显示锁屏提示 |

> `new`：临时状态，用户首次登录、尚未完成 onboard 时，自动跳转引导页。

### 权限速查表

| 功能 | 主任 | 出纳 | 会计 | 家长 |
|------|:----:|:----:|:----:|:----:|
| 查看收支报告 | ✅ | ✅ | ✅ | ✅ |
| 提交缴费登记 | | | | ✅ |
| 录入收费 | | ✅ | | |
| 添加支出 | | ✅ | | |
| 提交报销申请 | | ✅ | | |
| 确认缴费 | | ✅ | | |
| 审批报销 | | | ✅ | |
| 成员管理 | ✅ | ✅ | ✅ | |
| 花名册导入 | ✅ | | | |
| 角色管理 | ✅ | | | |
| 本期账目报告 | ✅ | | ✅ | |
| 开启新学期收费 | ✅ | | ✅ | |
| 班级设置（名称/学年） | ✅ | | | |

---

## 页面结构

```
pages/
├── index/       首页：余额总览、收费进度、快捷操作、最近记录
├── detail/      收支明细：收入/支出分 tab 列表
├── add/         录入页：收费录入 / 支出录入 / 报销申请
├── confirm/     待处理：缴费待确认（出纳）/ 报销待审批（会计）
├── record/      记录详情：收入/支出/报销单 详情 + 凭证查看
├── members/     成员管理：花名册 + 缴费状态 + 导入
├── roles/       角色管理（主任专属）：设置各成员角色
├── profile/     个人中心：个人信息 + 管理功能入口
└── onboard/     新用户引导：填写姓名 + 孩子姓名完成注册
```

### Tab Bar

| Tab | 页面 | 所有角色可见 |
|-----|------|:-----------:|
| 首页 | index | ✅ |
| 收支 | detail | ✅ |
| 我的 | profile | ✅ |

---

## 云数据库集合

### `classSettings`（班级设置，唯一一条）

| 字段 | 类型 | 说明 |
|------|------|------|
| className | string | 班级名称，如"三年级三班" |
| yearTerm | string | 当前学年，如"2024-2025" |
| totalStudents | number | 全班人数 |
| feePerStudent | number | 每人班费（元） |

### `classAdmins`（委员账号）

| 字段 | 类型 | 说明 |
|------|------|------|
| openid | string | 微信 openid |
| role | string | `chair` / `cashier` / `accountant` |

### `classMembers`（花名册）

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 学生姓名（唯一键） |
| studentNo | string | 学号，如"01" |
| createdAt | date | 创建时间 |

### `users`（注册用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | string | 微信 openid（自动） |
| name | string | 家长姓名 |
| childName | string | 孩子姓名（用于花名册验证） |
| avatarUrl | string | 头像 URL |
| createdAt | date | 注册时间 |

### `incomes`（收费记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| studentNo | string | 学号 |
| payer | string | 学生姓名（用于成员页匹配） |
| childName | string | 学生姓名 |
| payerName | string | 付款人（爸爸/妈妈） |
| amount | number | 金额（元） |
| date | string | 收款日期 |
| payMethod | string | 付款方式 |
| yearTerm | string | 所属学年（学期隔离关键字段） |
| notes | string | 备注 |
| createdBy | string | 操作人 openid |
| createdAt | date | 创建时间 |

### `expenses`（支出记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| title | string | 事项名称 |
| amount | number | 金额（元） |
| category | string | 类目（见下方类目表） |
| date | string | 支出日期 |
| eventName | string | 关联活动 |
| yearTerm | string | 所属学年 |
| receipts | array | 云存储 fileID 列表 |
| isPublic | boolean | 是否公开 |
| notes | string | 备注 |
| createdBy | string | 操作人 openid |
| createdAt | date | 创建时间 |

支出类目：`gift`礼品 / `decoration`布置 / `event`活动 / `trip`春游 / `supplies`文具 / `food`食品 / `other`其他

### `feeSubmissions`（家长缴费登记申请）

| 字段 | 类型 | 说明 |
|------|------|------|
| childName | string | 学生姓名 |
| payerName | string | 付款人姓名 |
| amount | number | 金额 |
| yearTerm | string | 所属学年 |
| status | string | `pending` / `confirmed` |
| submittedAt | date | 提交时间 |

### `expenseClaims`（报销申请）

| 字段 | 类型 | 说明 |
|------|------|------|
| title | string | 报销事项 |
| amount | number | 金额 |
| category | string | 类目 |
| date | string | 日期 |
| submitterName | string | 提交人姓名 |
| receipts | array | 云存储凭证 fileID 列表 |
| status | string | `pending` / `approved` / `rejected` |
| rejectReason | string | 拒绝原因（可选） |
| createdBy | string | 提交人 openid |
| createdAt | date | 提交时间 |

---

## 云函数

### `getRole`

登录时调用，返回当前用户角色和基本信息。

**逻辑**：
1. 查 `classAdmins` → 有记录且 role 合法 → 返回对应委员角色
2. 查/创建 `users` 记录
3. 非委员：有 childName → 查 `classMembers` → 在册返回 `parent`，不在册返回 `none`
4. 无 childName → 返回 `new`（触发 onboard）

**返回**：`{ openid, role, childName }`

### `confirmFeeSubmission`

出纳批量确认缴费登记，将 `feeSubmissions` 状态改为 `confirmed`，同时在 `incomes` 创建正式收费记录。

**入参**：`{ claimIds: string[] }`

### `approveExpenseClaim`

会计审批报销申请。

**入参**：`{ claimId, action: 'approve'|'reject', rejectReason }`
- `approve`：状态改为 `approved`，在 `expenses` 创建正式支出记录
- `reject`：状态改为 `rejected`，写入拒绝原因

---

## 首次使用流程

### 初始化（仅需一次）

1. 在云开发控制台手动创建以下集合：
   `classAdmins` / `classMembers` / `users` / `incomes` / `expenses` / `feeSubmissions` / `expenseClaims` / `classSettings`

2. 在 `classSettings` 创建一条初始记录：
   ```json
   { "className": "三年级二班", "yearTerm": "2024-2025", "totalStudents": 45, "feePerStudent": 200 }
   ```

3. 在 `classAdmins` 添加家委主任记录（先让主任扫码进入小程序，从 `users` 集合获取其 openid）：
   ```json
   { "openid": "<主任的openid>", "role": "chair" }
   ```

### 新成员加入流程

```
成员扫码进入小程序
    → onboard 页填写「家长姓名 + 孩子姓名」
    → 验证孩子在花名册中
    → 注册完成，角色默认为「三班合伙人」（parent）
    → 家委主任在「角色管理」页为其指定委员角色（如有需要）
```

### 新学期开启流程

```
家委主任或会计进入「我的」→「开启新学期收费」
    → 填写新学年（自动推算）+ 每人班费金额
    → 确认后更新 classSettings
    → 所有家长缴费状态自动重置为「未缴费」（旧记录保留）
```

---

## app.js 全局状态

```javascript
globalData: {
  openid,        // 当前用户 openid
  role,          // 当前角色
  childName,     // 孩子姓名（空 = 未完成 onboard）
  className,     // 班级名称
  yearTerm,      // 当前学年
  totalStudents, // 全班人数
  feePerStudent, // 每人班费
}

// 角色判断 getter
app.isCommittee  // chair | cashier | accountant
app.isChair      // chair
app.isCashier    // cashier
app.isAccountant // accountant
app.isParent     // parent | new
app.canView      // !== 'none'
```

---

## 开发测试

### 快速切换角色（测试用）

在 [app.js](app.js) `globalData` 初始值处临时修改，测完恢复：

```javascript
globalData: {
  openid: 'test-openid',   // ⚠️ 测试用
  role: 'cashier',         // chair | cashier | accountant | parent | none
  childName: '测试孩子',    // ⚠️ 测试用
  ...
}
```

同时注释掉 `checkLogin` 中真实角色的赋值行，防止云函数返回后覆盖。

### 各角色测试要点

| 角色 | 首页快捷区 | 个人中心管理功能 |
|------|-----------|----------------|
| chair | 收支报告、分享账本 | 收费管理*、确认缴费*、添加支出*、成员管理、角色管理、账目报告、开启新学期 |
| cashier | 录入收费、添加支出、提交报销、收支报告、分享账本 | 收费管理、确认缴费、添加支出、成员管理 |
| accountant | 审批报销、收支报告、分享账本 | 审批报销、成员管理、账目报告、开启新学期 |
| parent | 收支报告、分享账本、个人中心 | — |
| none | 🔒 锁屏 | — |

> *家委主任当前未在首页显示出纳操作按钮，管理功能通过个人中心访问。
