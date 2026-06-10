import { describe, expect, it } from 'vitest'
import { normalizeGeneratedRows } from '../../server/src/features/testcase/csv'

const header = ['用例编号', '功能模块', '功能测试点', '用例标题', '优先级', '前置条件', '测试步骤', '预期结果']

describe('normalizeGeneratedRows', () => {
  it('过滤模型解释文本，只保留真正的用例行', () => {
    const csv = `好的，下面开始生成登录功能测试用例。
用户要求必须是CSV格式。
用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果
TC001,登录,必填校验,用户名为空,高,打开登录页,"1. 清空用户名\\n2. 输入密码\\n3. 点击登录",提示用户名必填
这不是一条测试用例，只是模型解释`

    const result = normalizeGeneratedRows(csv, header)

    expect(result.header).toEqual(header)
    expect(result.rows).toEqual([
      ['TC001', '登录', '必填校验', '用户名为空', '高', '打开登录页', '1. 清空用户名\\n2. 输入密码\\n3. 点击登录', '提示用户名必填'],
    ])
  })

  it('表头前同一行混入模型解释时不会把解释文本当成表头', () => {
    const csv = `这样设计下来，应该能很好地覆盖正向、反向、边界、安全性等各个场景，符合标准覆盖的要求。,用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果
TC001,登录,正常流程,输入正确用户名和密码登录成功,高,用户已注册,"1. 打开登录页\\n2. 输入正确用户名\\n3. 输入正确密码\\n4. 点击登录",成功进入首页`

    const result = normalizeGeneratedRows(csv, header)

    expect(result.header).toEqual(header)
    expect(result.rows).toEqual([
      ['TC001', '登录', '正常流程', '输入正确用户名和密码登录成功', '高', '用户已注册', '1. 打开登录页\\n2. 输入正确用户名\\n3. 输入正确密码\\n4. 点击登录', '成功进入首页'],
    ])
  })

  it('按最大上限裁剪并统一重排用例编号', () => {
    const csv = `用例编号,功能模块,功能测试点,用例标题,优先级,前置条件,测试步骤,预期结果
TC099,登录,正向流程,正常登录,高,用户已注册,"1. 输入用户名\\n2. 输入密码\\n3. 点击登录",跳转首页
TC099,登录,反向流程,密码错误,中,用户已注册,"1. 输入用户名\\n2. 输入错误密码\\n3. 点击登录",提示密码错误
TC102,登录,边界校验,密码过短,中,打开登录页,"1. 输入用户名\\n2. 输入短密码\\n3. 点击登录",提示密码长度不足`

    const result = normalizeGeneratedRows(csv, header, { maxRows: 2 })

    expect(result.rows.map((row) => row[0])).toEqual(['TC001', 'TC002'])
    expect(result.rows).toHaveLength(2)
  })
})
