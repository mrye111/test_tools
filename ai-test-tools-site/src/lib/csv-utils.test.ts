import { describe, it, expect } from 'vitest'
import { parseCsvText } from './csv-utils'

describe('parseCsvText', () => {
  it('should handle simple CSV', () => {
    const csv = `"Name","Age"
"John","30"
"Jane","25"`
    const rows = parseCsvText(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]['Name']).toBe('John')
    expect(rows[0]['Age']).toBe('30')
  })

  it('should handle multi-line fields in quotes', () => {
    const csv = `"ID","Steps","Result"
"1","Step 1
Step 2
Step 3","Pass"
"2","Step A","Fail"`
    const rows = parseCsvText(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]['ID']).toBe('1')
    expect(rows[0]['Steps']).toBe('Step 1\nStep 2\nStep 3')
    expect(rows[0]['Result']).toBe('Pass')
    expect(rows[1]['ID']).toBe('2')
    expect(rows[1]['Steps']).toBe('Step A')
    expect(rows[1]['Result']).toBe('Fail')
  })

  it('should handle escaped double quotes', () => {
    const csv = `"ID","Desc"
"1","He said ""hello"""
"2","Normal text"`
    const rows = parseCsvText(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]['Desc']).toBe('He said "hello"')
    expect(rows[1]['Desc']).toBe('Normal text')
  })

  it('should handle zentao test case format with multi-line fields', () => {
    const csv = `"用例编号","所属模块","用例标题","前置条件","结果"
"1158","/我的证书","跳转测试","1.进入我的证书页面
2.跳转到反诈志愿者","通过"
"1157","/学习","志愿者介绍","1.进入页面","通过"`
    const rows = parseCsvText(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]['用例编号']).toBe('1158')
    expect(rows[0]['前置条件']).toContain('进入我的证书页面')
    expect(rows[0]['前置条件']).toContain('跳转到反诈志愿者')
    expect(rows[0]['结果']).toBe('通过')
    expect(rows[1]['用例编号']).toBe('1157')
    expect(rows[1]['结果']).toBe('通过')
  })

  it('should handle zentao bug format with multi-line reproduction steps', () => {
    const csv = `"Bug编号","所属模块","Bug标题","严重程度","Bug状态","指派给","创建日期","解决日期"
"242","/接口","获取用户信息接口错误","3","已关闭","张明亮","2024-05-14 14:39:17","2024-05-14 16:48:29"
"241","/首页","登录后无弹窗","4","已关闭","王鲁光","2024-05-14 14:22:49","2024-05-14 16:18:50"`
    const rows = parseCsvText(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]['Bug编号']).toBe('242')
    expect(rows[0]['严重程度']).toBe('3')
    expect(rows[0]['Bug状态']).toBe('已关闭')
    expect(rows[0]['指派给']).toBe('张明亮')
  })

  it('should handle CRLF line endings', () => {
    const csv = `"ID","Name"\r\n"1","Alice"\r\n"2","Bob"`
    const rows = parseCsvText(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]['Name']).toBe('Alice')
  })
})
