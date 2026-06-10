# AI 生成 JMX 全面测试场景

## 场景 1：HTTP 压测（基础场景）
**提示词：**
"测试百度首页的并发性能，100个用户同时访问，持续30秒，验证响应状态码为200"

**预期 AI 输出：**
```json
{
  "testPlan": { "name": "百度首页并发测试", "comments": "..." },
  "threadGroup": { "name": "用户组", "threads": 100, "rampUp": 5, "duration": 30 },
  "samplers": [
    { "type": "http", "name": "访问百度首页", "method": "GET", "url": "https://www.baidu.com/" }
  ],
  "assertions": [{ "type": "responseCode", "expected": "200" }],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**验证点：**
- ✅ ThreadGroup: threads=100, rampUp=5, loops=-1 (因为有 duration)
- ✅ HTTP Sampler: method=GET, domain=www.baidu.com, protocol=https, path=/
- ✅ Response Assertion: pattern=200
- ✅ Listeners: aggregate_report, view_results_tree

---

## 场景 2：HTTP POST 请求（带请求体和自定义头）
**提示词：**
"测试用户注册接口 https://api.example.com/auth/register，POST 方法，50个并发用户，循环10次，请求体是 JSON 格式：{\"username\":\"test\",\"password\":\"123456\"}，添加 Content-Type: application/json 请求头，验证状态码为201"

**预期 AI 输出：**
```json
{
  "testPlan": { "name": "用户注册接口测试", "comments": "..." },
  "threadGroup": { "name": "注册用户", "threads": 50, "rampUp": 5, "loops": 10 },
  "samplers": [
    {
      "type": "http",
      "name": "注册接口",
      "method": "POST",
      "url": "https://api.example.com/auth/register",
      "headers": { "Content-Type": "application/json" },
      "body": "{\"username\":\"test\",\"password\":\"123456\"}"
    }
  ],
  "assertions": [{ "type": "responseCode", "expected": "201" }],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**验证点：**
- ✅ ThreadGroup: loops=10 (没有 duration，使用 loops)
- ✅ HTTP Sampler: method=POST, bodyData 包含 JSON
- ✅ Headers: Content-Type: application/json
- ✅ Assertion: expected=201

---

## 场景 3：数据库查询压测（JDBC）
**提示词：**
"测试 MySQL 数据库查询性能，连接字符串是 jdbc:mysql://localhost:3306/testdb，驱动是 com.mysql.cj.jdbc.Driver，用户名 root，密码 password123，执行查询 SELECT * FROM users LIMIT 100，20个并发连接，循环5次"

**预期 AI 输出：**
```json
{
  "testPlan": { "name": "MySQL查询性能测试", "comments": "..." },
  "threadGroup": { "name": "数据库连接", "threads": 20, "rampUp": 2, "loops": 5 },
  "samplers": [
    {
      "type": "jdbc",
      "name": "查询用户表",
      "connection": {
        "name": "MySQL Connection",
        "url": "jdbc:mysql://localhost:3306/testdb",
        "driver": "com.mysql.cj.jdbc.Driver",
        "username": "root",
        "password": "password123"
      },
      "sql": "SELECT * FROM users LIMIT 100"
    }
  ],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**验证点：**
- ✅ JDBC Config: url, driver, username, password 都正确设置
- ✅ JDBC Sampler: sql 正确
- ✅ 没有 assertions（可选）

---

## 场景 4：TCP 服务器测试
**提示词：**
"测试 TCP 服务器 192.168.1.100 端口 8888，发送消息 'HELLO SERVER'，10个并发连接，循环3次"

**预期 AI 输出：**
```json
{
  "testPlan": { "name": "TCP服务器测试", "comments": "..." },
  "threadGroup": { "name": "TCP连接", "threads": 10, "rampUp": 1, "loops": 3 },
  "samplers": [
    {
      "type": "tcp",
      "name": "发送TCP消息",
      "server": "192.168.1.100",
      "port": 8888,
      "requestData": "HELLO SERVER"
    }
  ],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**验证点：**
- ✅ TCP Sampler: server, port, requestData 正确

---

## 场景 5：SMTP 邮件发送测试
**提示词：**
"测试邮件服务器 smtp.example.com 端口 25，发件人 test@example.com，收件人 user@example.com，主题 'Test Email'，正文 'This is a test email'，5个并发，循环2次"

**预期 AI 输出：**
```json
{
  "testPlan": { "name": "SMTP邮件测试", "comments": "..." },
  "threadGroup": { "name": "邮件发送", "threads": 5, "rampUp": 1, "loops": 2 },
  "samplers": [
    {
      "type": "smtp",
      "name": "发送测试邮件",
      "server": "smtp.example.com",
      "port": 25,
      "sender": "test@example.com",
      "receiver": "user@example.com",
      "subject": "Test Email",
      "body": "This is a test email"
    }
  ],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**验证点：**
- ✅ SMTP Sampler: server, port, sender, receiver, subject, body 都正确

---

## 场景 6：FTP 文件操作测试
**提示词：**
"测试 FTP 服务器 ftp.example.com 端口 21，用户名 ftpuser，密码 ftppass，下载文件 /data/test.txt，3个并发，循环1次"

**预期 AI 输出：**
```json
{
  "testPlan": { "name": "FTP文件下载测试", "comments": "..." },
  "threadGroup": { "name": "FTP操作", "threads": 3, "rampUp": 1, "loops": 1 },
  "samplers": [
    {
      "type": "ftp",
      "name": "下载测试文件",
      "server": "ftp.example.com",
      "port": 21,
      "username": "ftpuser",
      "password": "ftppass",
      "remoteFile": "/data/test.txt"
    }
  ],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**验证点：**
- ✅ FTP Sampler: server, port, username, password, remoteFile 都正确

---

## 场景 7：LDAP 查询测试
**提示词：**
"测试 LDAP 服务器 ldap.example.com 端口 389，查询基准 DN 是 dc=example,dc=com，过滤条件 (cn=*admin*)，5个并发，循环2次"

**预期 AI 输出：**
```json
{
  "testPlan": { "name": "LDAP查询测试", "comments": "..." },
  "threadGroup": { "name": "LDAP查询", "threads": 5, "rampUp": 1, "loops": 2 },
  "samplers": [
    {
      "type": "ldap",
      "name": "查询管理员",
      "server": "ldap.example.com",
      "port": 389,
      "searchBase": "dc=example,dc=com",
      "searchFilter": "(cn=*admin*)"
    }
  ],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**验证点：**
- ✅ LDAP Sampler: server, port, searchBase, searchFilter 都正确

---

## 场景 8：JSR223 脚本测试
**提示词：**
"执行 Groovy 脚本测试，脚本内容是 'log.info(\"Test running\"); return \"OK\"'，10个并发，循环5次"

**预期 AI 输出：**
```json
{
  "testPlan": { "name": "Groovy脚本测试", "comments": "..." },
  "threadGroup": { "name": "脚本执行", "threads": 10, "rampUp": 2, "loops": 5 },
  "samplers": [
    {
      "type": "jsr223",
      "name": "执行Groovy脚本",
      "language": "groovy",
      "script": "log.info(\"Test running\"); return \"OK\""
    }
  ],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**验证点：**
- ✅ JSR223 Sampler: language=groovy, script 正确

---

## 场景 9：系统命令执行测试
**提示词：**
"执行系统命令 ping -c 4 8.8.8.8，2个并发，循环1次"

**预期 AI 输出：**
```json
{
  "testPlan": { "name": "Ping测试", "comments": "..." },
  "threadGroup": { "name": "命令执行", "threads": 2, "rampUp": 1, "loops": 1 },
  "samplers": [
    {
      "type": "system",
      "name": "Ping Google DNS",
      "command": "ping",
      "params": "-c 4 8.8.8.8"
    }
  ],
  "listeners": ["aggregate_report", "view_results_tree"]
}
```

**验证点：**
- ✅ System Sampler: command, params 正确

---

## 验证策略

对每个场景：
1. 使用测试用例直接验证（不依赖真实 AI）
2. 检查 `ai-translator.ts` 是否正确处理所有字段
3. 检查生成的 JMX 是否包含所有必需元素

下一步：你想让我为这些场景创建自动化测试吗？
