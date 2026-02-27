# KeyKurs Backend

Express.js REST API сервер. Замена Supabase Edge Functions для деплоя на Timeweb Cloud Apps.

## Требования

- Node.js 20+
- PostgreSQL (Timeweb DBaaS)
- S3-совместимое хранилище (Timeweb Object Storage)

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

| Переменная | Описание |
|-----------|----------|
| `DATABASE_URL` | Строка подключения к PostgreSQL |
| `JWT_SECRET` | Случайная строка не менее 64 символов |
| `S3_ENDPOINT` | Endpoint S3 Timeweb, например `https://s3.twcstorage.ru` |
| `S3_REGION` | Регион, например `ru-1` |
| `S3_BUCKET` | Имя бакета |
| `S3_ACCESS_KEY` | Access Key S3 |
| `S3_SECRET_KEY` | Secret Key S3 |
| `APP_URL` | URL фронтенда для CORS и OAuth редиректов |
| `BACKEND_URL` | Внешний URL бэкенда (для OAuth callback URI) |
| `VK_CLIENT_ID` | ID приложения ВКонтакте |
| `VK_CLIENT_SECRET` | Secret приложения ВКонтакте |
| `YANDEX_CLIENT_ID` | Client ID Яндекс OAuth |
| `YANDEX_CLIENT_SECRET` | Client Secret Яндекс OAuth |
| `PORT` | Порт сервера (по умолчанию 3000) |

## API маршруты

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/auth/telegram` | Telegram Login Widget авторизация |
| GET | `/api/auth/me` | Получить текущего пользователя (JWT) |
| GET | `/api/auth/oauth?provider=vk\|yandex` | Начать OAuth поток |
| POST | `/api/auth/oauth/pkce` | Сохранить PKCE сессию (VK) |
| GET | `/api/auth/oauth/callback` | OAuth callback (VK / Яндекс) |
| POST | `/api/auth/oauth/session` | Создать JWT сессию после OAuth |
| GET | `/api/media/:fileId` | Получить медиафайл из S3 (стриминг видео) |
| POST | `/api/media/upload` | Загрузить файл в S3 |
| POST | `/api/media/token` | Создать временный токен доступа к файлу |
| GET | `/api/telegram/bot-username` | Получить имя бота для Telegram Login Widget |
| GET | `/api/sellers/check` | Проверить наличие продавца у пользователя |
| POST | `/api/webhook/:botId` | Telegram webhook (скачивает медиа в S3) |
| GET | `/health` | Health check |

## Telegram Webhook

При регистрации webhook в Telegram используйте URL:
```
https://your-backend.twc1.net/api/webhook/{BOT_ID}
```

Где `{BOT_ID}` — это UUID бота из таблицы `telegram_bots`.

## Ключевое отличие от Supabase Edge Functions

Webhook **немедленно скачивает медиафайлы** из Telegram и загружает их в S3, записывая `storage_path` в БД. Это означает:
- Файлы хранятся постоянно и не зависят от Telegram
- Для доступа к файлам не требуется bot token
- `telegram_file_id` после импорта в БД всегда `NULL`

## Миграция существующих данных

Если при переносе с Supabase в БД есть старые записи с `telegram_file_id`:

```bash
npx ts-node scripts/migrate-media.ts
```

## Деплой на Timeweb Cloud Apps

1. Создайте приложение типа **Docker** или **Node.js**
2. Подключите этот репозиторий
3. Добавьте все переменные окружения
4. Timeweb автоматически пересоберёт при каждом push в main
