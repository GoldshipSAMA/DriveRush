# DriveRush Cloud Sync Backend (Java)

## 功能

- `POST /api/auth/register` 注册并返回 token
- `POST /api/auth/login` 登录并返回 token
- `POST /api/sync/import` 把前端本地数据同步到 MySQL（需要 Bearer token）

接口格式已对齐 `frontend/background.js` 当前调用方式。

## 环境要求

- JDK 17+
- Maven 3.9+
- MySQL（库名：`drive_rush`，默认用户：`root`，空密码）

## 启动

```bash
cd backend
mvn spring-boot:run
```

默认监听：`http://localhost:3000`

## 配置

配置文件：`src/main/resources/application.yml`

- 数据库：`spring.datasource.*`
- JWT 密钥：环境变量 `DR_JWT_SECRET`（强烈建议在生产环境设置）

## 说明

- 启动时会自动执行 `schema.sql`（`CREATE TABLE IF NOT EXISTS`，可重复执行）。
- 未登录用户无法调用 `/api/sync/import`。
