# План переноса BotAnti на Userbot (GramJS)

Цель: перейти с **Bot API** (Grammy) на **Telegram Client API** (userbot, GramJS), чтобы бот работал от аккаунта пользователя и мог читать каналы/группы без ограничений бота.

---

## 1. Текущая архитектура (что переносим)

### 1.1 Зависимости от Telegram (Bot API)
| Компонент | Использование Bot API | Замена в userbot |
|-----------|------------------------|------------------|
| **bot.ts** | `new Bot(BOT_TOKEN)`, `bot.start()`, `allowed_updates` | `TelegramClient`, сессия (apiId, apiHash, phone), `client.start()` |
| **config** | `BOT_TOKEN`, `ADMINS` (user IDs) | `API_ID`, `API_HASH`, `SESSION_STRING` или phone, `ADMINS` без изменений |
| **admin.ts** | `InlineKeyboard`, `ctx.reply`, `ctx.editMessageText`, `callback_query:data` | GramJS: `new Api.InlineKeyboard`, `client.invoke()`, callback через `client.on("callback_query", ...)` или ручная разметка кнопок |
| **commands.ts** | `bot.command()`, `ctx.reply`, `ctx.chat.id`, `ctx.from` | `client.on("message", ...)` + разбор текста на `/command`, `message.chatId`, `message.senderId` |
| **callbacks.ts** | `bot.on('callback_query:data')`, `ctx.answerCallbackQuery`, `ctx.editMessageText` | GramJS callback query (если поддерживается для инлайн-кнопок от userbot) или замена на команды/меню |
| **messageHandler.ts** | `bot.on('message')`, `bot.on('channel_post')`, `bot.on('edited_channel_post')`, `ctx.message`, `ctx.channelPost` | `client.on("message", ...)`, события постов канала (GramJS: NewMessage в канале), объекты Message |
| **violationHandler.ts** | `bot.api.getChatMember`, `bot.api.sendMessage`, `bot.api.deleteMessage`, `bot.api.forwardMessage` | `client.invoke( new Api.channels.GetParticipant )`, `client.sendMessage`, `client.deleteMessages` |
| **documentHandler.ts** | `ctx.message.document`, загрузка файла через Bot API | Получение файла через MTProto (client.downloadMedia / getMessages) |

### 1.2 Что не зависит от Telegram (оставляем как есть)
- **db.ts** — SQLite, таблицы, getWords/addWord/deleteWord.
- **filters.ts** — множества слов, checkProfanity/checkAd/checkCustom.
- **state.ts** — флаги фильтров, нейросеть, темы (можно оставить или слегка подчистить).
- **neural.ts** — вызов Ollama по HTTP (axios), темы, analyzeSequentially (без изменений по сути).
- **config.ts** — часть: ALLOWED_CHATS, LOG_CHAT_ID, FILTER_*, слова из .env (логика та же, меняем только способ авторизации и BOT_TOKEN → API_ID/API_HASH).

---

## 2. Отличия Bot API vs Userbot (GramJS)

| Аспект | Bot API (сейчас) | Userbot (GramJS) |
|--------|------------------|------------------|
| Авторизация | Токен от @BotFather | API_ID + API_HASH (my.telegram.org) + номер телефона или session string |
| Каналы | Только если бот админ, `channel_post` в getUpdates | Доступ ко всем каналам, где пользователь подписан; посты приходят как сообщения |
| Группы | Бота нужно добавлять | Аккаунт уже участник, все сообщения видны |
| Удаление сообщений | От имени бота (права админа бота) | От имени пользователя (права админа пользователя в чате) или оставить бота в чате только для удаления |
| Inline-кнопки / callback | `callback_query` с `data` | В клиентском API инлайн-кнопки и callback работают иначе; возможна замена на текстовые команды или простые кнопки |
| Команды | `bot.command('name')` | Ручной разбор `message.text.startsWith('/name')` |
| Получение файлов | `ctx.message.document`, `getFile` | `message.document`, `client.downloadMedia()` |

---

## 3. Поэтапный план переноса

### Фаза 0: Подготовка (1–2 дня)
- [ ] Создать приложение на https://my.telegram.org, получить **API_ID** и **API_HASH**.
- [ ] Добавить в `.env`: `API_ID`, `API_HASH`; опционально `SESSION_STRING` (если будем хранить сессию).
- [ ] Новый репозиторий или ветка `userbot`, чтобы текущий бот продолжал работать.
- [ ] Установить GramJS: `npm i telegram` (пакет `telegram` — это GramJS).
- [ ] Изучить GramJS: события (NewMessage, channel posts), отправка/удаление сообщений, загрузка файлов, сессии (StringSession).

### Фаза 1: Точка входа и конфиг (0.5–1 день)
- [ ] Новый файл `src/client.ts` (или `src/userbot.ts`): создание `TelegramClient`, логин по номеру/коду или по сохранённой сессии.
- [ ] Обновить `config.ts`: убрать проверку `BOT_TOKEN`, добавить `API_ID`, `API_HASH`; оставить `ADMINS`, `ALLOWED_CHATS`, `LOG_CHAT_ID`, фильтры, слова.
- [ ] Запуск: `client.start()` после инициализации БД и загрузки слов (аналог текущего `main()` в bot.ts).

### Фаза 2: Сообщения и каналы (1–2 дня)
- [ ] Обработчик входящих сообщений: `client.on("message", handler)`.
  - Различать личные чаты, группы, супергруппы; при необходимости — каналы (где userbot подписан).
- [ ] Получение постов канала: в GramJS канальные посты приходят как сообщения из чата с `message.post === true` (или через отдельные события — проверить по доке). Реализовать аналог текущих `channel_post` и `edited_channel_post`.
- [ ] Фильтрация по `ALLOWED_CHATS`: обрабатывать только чаты из списка (если список задан).
- [ ] Вынести общую логику проверки текста (фильтры + нейросеть) в один модуль, вызываемый из обработчика сообщений и постов канала (как сейчас `detectViolation` + нейросеть в messageHandler).

### Фаза 3: Нарушения и удаление (1 день)
- [ ] Заменить `violationHandler`: вместо `bot.api.*` использовать `client.sendMessage`, `client.deleteMessages`, `client.forwardMessages` (или аналог).
- [ ] Проверка прав на удаление: в userbot — от имени пользователя. Варианты: вызывать `client.invoke(new Api.channels.GetParticipant(...))` и смотреть права, или не удалять, а только логировать в LOG_CHAT_ID.
- [ ] Логирование нарушений в LOG_CHAT_ID оставить; при необходимости — пересылка сообщения через `client.forwardMessages` или отправка текста лога.

### Фаза 4: Команды (0.5–1 день)
- [ ] Реализовать команды без Grammy: в обработчике `message` проверять `message.text?.startsWith('/')`, парсить команду и аргументы.
  - `/check_chat`, `/stop_check_chat`, `/check_permissions`, `/analyze`, `/start` (если нужен) и т.д.
- [ ] Проверка админа: `ADMINS.includes(message.senderId)` (или аналог получения user id в GramJS).

### Фаза 5: Документы и анализ (1–2 дня)
- [ ] Загрузка файлов: при получении сообщения с документом вызывать `client.downloadMedia()` (или эквивалент), сохранять во временный файл, парсить JSON/HTML как в `documentHandler`.
- [ ] Адаптировать `documentHandler.ts`: убрать зависимость от `Context`; на вход — путь к файлу или buffer, на выход — `MessageData[]` и метаданные (как сейчас).
- [ ] Команда `/analyze` и запуск анализа в фоне оставить; отмена по флагу/AbortController уже реализована — убедиться, что в userbot обработчик callback/команды отмены может выставить флаг и что цикл анализа по-прежнему не блокирует приём обновлений (асинхронный запуск).

### Фаза 6: Админ-панель и инлайн-кнопки (2–3 дня)
- [ ] В GramJS инлайн-кнопки с callback для пользовательского клиента могут отличаться. Варианты:
  - Реализовать меню через **текстовые команды** (например `/admin` → список пунктов, `/admin_words`, `/admin_stats`, `/admin_toggle_profanity` и т.д.).
  - Либо использовать GramJS InlineKeyboard и обрабатывать callback query (если API поддерживает для аккаунта пользователя).
- [ ] Перенести логику: переключение фильтров (брань, реклама, нейросеть, удаление), смена модели, темы нейросети, список слов, статистика — всё через новый слой (функции из state.ts, db, neural.ts вызывать без изменений).

### Фаза 7: Callback «Отмена» и анализ (0.5 дня)
- [ ] Если инлайн-кнопки с callback доступны: при нажатии «Отменить анализ» вызывать тот же код, что и сейчас (установка `analysis.cancel`, `controller.abort()`).
- [ ] Если callback нет — добавить команду `/cancel_analysis` и по ней выполнять отмену для текущего чата.

### Фаза 8: Тесты и деплой (1–2 дня)
- [ ] Проверить: личка, группа, канал (чтение постов, удаление при нарушении, лог в LOG_CHAT_ID).
- [ ] Проверить: загрузка файла → анализ → отмена по кнопке/команде.
- [ ] Обновить Docker/start.sh: убрать BOT_TOKEN, добавить переменные для сессии (API_ID, API_HASH, при необходимости SESSION_STRING или интерактивный первый вход).
- [ ] Документация: как получить API_ID/API_HASH, как первый раз залогиниться (код из телефона), как сохранить сессию для последующих запусков.

---

## 4. Структура файлов после переноса (предложение)

```
src/
  client.ts          # TelegramClient, логин, запуск
  config.ts          # API_ID, API_HASH, ADMINS, ALLOWED_CHATS, LOG_CHAT_ID, фильтры, слова
  db.ts              # без изменений
  filters.ts         # без изменений
  state.ts           # без изменений (или минимальные правки)
  neural.ts          # без изменений
  handlers/
    messages.ts      # обработка message + посты канала, вызов фильтров и violation
    commands.ts     # разбор /command
    violation.ts    # логика нарушений, отправка/удаление через client
    document.ts     # парсинг экспорта (без ctx), вызов из messages при получении файла
    analysis.ts     # анализ файла нейросетью (как messageAnalysis), отмена
  admin/
    index.ts        # команды/меню админки
    keyboards.ts    # при необходимости — построение клавиатур для GramJS
  index.ts          # main: initDB, загрузка слов, client.start(), регистрация обработчиков
```

Текущие `callbacks.ts` и часть `admin.ts` войдут в обработку callback или в текстовое меню админки.

---

## 5. Риски и упрощения

- **Inline callback в userbot** может быть неудобным или отличаться — готовность заменить админ-панель на команды ускорит перенос.
- **Удаление сообщений в канале**: от имени пользователя возможно только если он админ канала с правом удалять; иначе только логирование.
- **Два аккаунта**: можно оставить бота в чатах для удаления сообщений (от имени бота), а userbot — только для чтения и логики; тогда часть кода остаётся на Bot API, а чтение переводится на GramJS. Это усложняет архитектуру, поэтому на первом этапе разумно всё вести через userbot.

---

## 6. Порядок работ (краткий чеклист)

1. Фаза 0 — подготовка и GramJS.
2. Фаза 1 — client + config.
3. Фаза 2 — приём сообщений и постов канала, вызов фильтров.
4. Фаза 3 — нарушение: лог + удаление через client.
5. Фаза 4 — команды.
6. Фаза 5 — документы и анализ.
7. Фаза 6 — админка (команды или callback).
8. Фаза 7 — отмена анализа.
9. Фаза 8 — тесты и деплой.

Оценка по времени: **8–14 дней** при работе по 2–4 часа в день (зависит от знакомства с GramJS и выбора реализации админки).

Если нужно, следующий шаг — реализовать Фазу 0 и Фазу 1 (клиент + конфиг + пустой обработчик сообщений) в коде.
