# BotAnti – Антиспам и модерация для Telegram

**Два режима:** **Userbot** (по умолчанию) — только модерация в реальном времени от имени вашего аккаунта; **Bot** (Grammy) — админ-панель, управление словами/темами, загрузка и анализ файлов. Настройки общие (одна БД): меняете в боте — userbot подхватывает.

---

## Режимы работы

| Режим | Описание | Точка входа |
|-------|----------|-------------|
| **Userbot** | Только модерация в реальном времени (нейросеть + фильтры). Без админки и без приёма файлов. | `npm run dev` / `node dist/index.js` |
| **Bot** | Админ-панель, команды, загрузка/анализ файлов (HTML/JSON), модерация в чатах, где бот админ. | `npm run dev:bot` / `node dist/bot.js` |

Подробная настройка и тест Userbot: [TEST_USERBOT.md](BotAnti/TEST_USERBOT.md).

---

## Как запустить (Docker)

### 1. Установите и запустите Docker

- **Windows / macOS:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) — установите и дождитесь иконки в трее.
- **Linux:** установите Docker Engine. Если при запуске появляется `Permission denied`:
  ```bash
  sudo usermod -aG docker $USER
  ```
  Затем **выйдите из системы и зайдите снова** (или перезагрузите компьютер). После этого `docker-compose` будет работать без `sudo`.

### 2. Откройте проект и перейдите в папку BotAnti

```bash
cd BotAnti
```

### 3. Настройте `.env`

Скопируйте пример и заполните (см. раздел [Конфигурация](#-конфигурация)):

```bash
# Windows (cmd):
copy .env.example .env

# Linux / macOS:
cp .env.example .env
```

Для **Userbot** обязательны `API_ID`, `API_HASH` и `SESSION_STRING`.

- **Если используете тот же аккаунт, что и другой человек** — попросите у него готовые `API_ID`, `API_HASH` и `SESSION_STRING` и вставьте в `.env`. Регистрация в терминале не нужна.
- **Если настраиваете свой аккаунт впервые** — в Docker **нельзя** ввести телефон и код. Сначала запустите без Docker: `npm run dev`, введите телефон и код, скопируйте выведенную строку `SESSION_STRING=...` в `.env`, затем уже запускайте `docker-compose up -d`. Подробнее: [TEST_USERBOT.md](BotAnti/TEST_USERBOT.md).

### 4. Запустите контейнер

```bash
docker-compose up -d
```

### 5. Проверьте статус

```bash
docker-compose ps
```

Должны быть **Up** оба контейнера: **botanti-userbot** и **botanti-bot**.

По умолчанию `docker-compose up -d` запускает **и userbot, и бота** (общая БД). Запустить только один: `docker-compose up -d userbot` или `docker-compose up -d bot`. Подробнее: [SETUP.md](SETUP.md).

---

## Основные команды Docker

| Команда | Описание |
|---------|----------|
| `docker-compose up -d` | Запустить оба (userbot + бот) |
| `docker-compose up -d userbot` | Только userbot |
| `docker-compose up -d bot` | Только бот |
| `docker-compose down` | Остановить все |
| `docker-compose logs -f` | Логи в реальном времени |
| `docker-compose logs -f userbot` / `docker-compose logs -f bot` | Логи одного сервиса |
| `docker-compose ps` | Статус контейнеров |
| `docker-compose restart` | Перезапустить |
| `docker-compose logs --tail=50` | Последние 50 строк логов |

Запуск и проверка одной командой:

```bash
docker-compose up -d && docker-compose ps
```

---

## Основные возможности

- **Фильтрация по ключевым словам** — брань, реклама, пользовательские запрещённые слова
- **Нейросетевой анализ** — анализ сообщений через LLM (Ollama и совместимые API)
- **Анализ файлов** — массовый разбор экспорта чатов (HTML/JSON) **через бота**
- **Статистика** — нарушения по времени и типам
- **Гибкая настройка** — фильтры и тематики нейросети (админ-панель **в боте**)
- **Userbot** — только модерация в реальном времени; настройки подтягиваются из общей БД

---

## Содержание

- [Установка без Docker](#-установка-без-docker)
- [Конфигурация](#-конфигурация)
- [Настройка бота в чате](#-настройка-бота-в-чате)
- [Использование](#-использование)
- [Команды](#-команды)
- [Админ-панель](#-админ-панель)
- [Фильтры](#-фильтры)
- [Нейросеть](#-нейросеть)
- [Анализ файлов](#-анализ-файлов)
- [Статистика и БД](#-статистика-и-база-данных)
- [Структура проекта](#-структура-проекта)
- [Бот vs Userbot](#бот-vs-userbot)
- [Разработка](#-разработка)

---

## Установка без Docker

### Требования

- Node.js 18+
- npm или yarn
- **Userbot**: API_ID и API_HASH с [my.telegram.org](https://my.telegram.org)
- **Bot**: токен от [@BotFather](https://t.me/BotFather)
- Для нейросети: доступ к Ollama или совместимому API

### Шаги

1. Клонируйте репозиторий и перейдите в папку бота:

```bash
git clone <repository-url>
cd BotAnti
```

2. Установите зависимости:

```bash
npm install
```

3. Создайте `.env` (см. [Конфигурация](#-конфигурация)).

4. Соберите проект:

```bash
npm run build
```

5. Запуск:

- **Userbot** (по умолчанию): `npm start` или `npm run dev`
- **Только бот**: `npm run start:bot` или `npm run dev:bot`

---

## Конфигурация

Файл `.env` в папке **BotAnti**.

### Userbot (режим по умолчанию)

```env
# Обязательно: https://my.telegram.org
API_ID=12345678
API_HASH=abcdef1234567890abcdef1234567890

# После первого входа сохраните сюда выведенную строку
# SESSION_STRING=...

# Опционально: username бота без @ — отчёты о нарушениях в личку боту
# BOT_USERNAME=MyBotName
```

### Бот (режим Grammy)

```env
BOT_TOKEN=123456:ABC-def...
```

### Общие параметры

```env
# Админы: ID через запятую или "me" (для userbot — текущий аккаунт)
ADMINS=123456789,me

# Разрешённые чаты (ID через запятую; пусто = все)
ALLOWED_CHATS=-1001234567890

# Куда слать логи нарушений: me = Избранное, или ID через запятую
LOG_CHAT_ID=me

# Фильтры (true/false)
FILTER_PROFANITY=true
FILTER_ADVERTISING=true

# Начальные слова (через запятую)
PROFANITY_WORDS=слово1,слово2
AD_KEYWORDS=реклама,спам,http
```

### Получение Chat ID

- **Бот**: в нужном чате отправьте сообщение боту и выполните `npx tsx src/get_group_id.ts` (бот вернёт Chat ID).
- **Userbot**: ID можно узнать через @userinfobot / @getidsbot в нужном чате или из логов.

---

## Настройка бота в чате (режим Bot)

1. Добавьте бота в группу/канал по username.
2. Назначьте бота администратором.
3. Выдайте права:
   - **Удаление сообщений** (обязательно)
   - Блокировка пользователей (по желанию)
   - Закрепление сообщений (по желанию)

Проверка прав в группе: команда `/check_permissions`.

---

## Использование

- **Модерация в реальном времени** — userbot и/или бот проверяют сообщения (нейросеть + фильтры).
- **Режим проверки в ЛС** — `/check_chat` в боте: тест фильтров в личке.
- **Анализ файлов** — только в боте: отправьте экспорт чата (HTML/JSON) боту, затем `/analyze`.

---

## Команды

### Бот (все команды только в боте)

- `/start` — приветствие; для админов — клавиатура
- `/admin` — админ-панель (в ЛС)
- `/analyze` — анализ загруженных файлов (после отправки документов боту)
- `/check_chat`, `/stop_check_chat` — режим проверки в личке
- `/check_permissions` — проверка прав бота в группе
- `/filter_author` — фильтр по автору для анализа файла

**Слова:** `/add_profanity`, `/del_profanity`, `/add_ad`, `/del_ad`, `/add_custom`, `/del_custom`

**Нейросеть:** `/test_neural <текст>`, `/models`, `/neural_stats`

**Тематики:** `/add_topic <имя> | <описание> | <приоритет> | <prompt>`, `/del_topic <имя>`

**Userbot** команд не обрабатывает — только просматривает сообщения и модерирует в реальном времени. Подробнее: [BOT_VS_USERBOT.md](BotAnti/docs/BOT_VS_USERBOT.md).

---

## Админ-панель

Открывается командой `/admin` в личных сообщениях (пользователи из `ADMINS`).

- **Удаление** — вкл/выкл автоудаление нарушений
- **Брань / Реклама / Нейросеть** — вкл/выкл фильтры
- **Модель** — выбор модели нейросети
- **Темы нейросети** — настройка тематик
- **Статистика** — нарушения за час / неделю / всего
- **Список слов** — просмотр фильтров
- **Команды** — справка

---

## Фильтры

1. **Брань** (`FILTER_PROFANITY`) — запрещённые слова из списка и БД.
2. **Реклама** (`FILTER_ADVERTISING`) — рекламные ключевые слова.
3. **Пользовательские слова** — произвольные слова из БД, всегда активны.

Порядок: сначала нейросеть (если включена), затем проверка по ключевым словам. При первом срабатывании обработка завершается.

---

## Нейросеть

URL API задаётся в `src/neural.ts` (по умолчанию Ollama). Тематики хранятся в БД и настраиваются через `/add_topic` или админ-панель. Уверенность > 80% считается нарушением.

---

## Анализ файлов

Работает **только в боте**. Поддерживаются экспорты Telegram Desktop: **HTML** и **JSON**.

1. Отправьте файл боту в ЛС (или в чат, где бот есть).
2. При необходимости задайте фильтр по автору: `/filter_author <имя или user_id>`.
3. Выполните `/analyze` и выберите объём кнопками (все / 500 / 1000 / …).
4. Получите отчёт по нарушениям. Во время анализа можно отменить кнопкой «Отменить анализ».

---

## Статистика и база данных

Типы нарушений: `violation_profanity`, `violation_ad`, `violation_custom`, `neural_*` (по темам).

SQLite: `database.db` (в Docker — том `botanti_data`, путь `/data/database.db`). Таблицы: `statistics`, `profanity_words`, `ad_keywords`, `custom_words`, `topics`.

---

## Структура проекта (Clean Architecture + Core)

Подробнее: [BotAnti/src/ARCHITECTURE.md](BotAnti/src/ARCHITECTURE.md).

```
BotAnti/
├── src/
│   ├── core/                 # Ядро (без внешних зависимостей)
│   │   ├── entities/         # Message, Violation, Topic
│   │   ├── ports/            # IDatabase, IAiProvider, ILogger, ISettings
│   │   ├── filters/          # keywordFilter (чистая логика)
│   │   └── use-cases/        # moderateMessage, analyzeDocument
│   ├── infrastructure/       # Адаптеры
│   │   ├── config/           # envConfig
│   │   ├── database/         # sqlite (IDatabase)
│   │   ├── ai/               # ollama (IAiProvider)
│   │   ├── logging/         # consoleLogger
│   │   ├── settings/        # stateSettingsAdapter
│   │   └── topics/          # topicsProvider
│   ├── delivery/             # Доставка (бот / userbot)
│   │   ├── common/           # adminPanel, keyboards
│   │   ├── bot/              # Grammy: bot.ts, controllers/, middlewares/
│   │   └── userbot/          # MTProto: userbot.ts, client.ts, handlers/
│   ├── shared/               # errors, utils (violationReason и др.)
│   ├── index.ts              # Точка входа Userbot
│   ├── bot.ts                # Точка входа Bot
│   ├── config.ts             # Конфигурация из .env
│   ├── db.ts                 # БД (используется адаптером)
│   ├── state.ts              # Состояние (используется адаптером)
│   ├── filters.ts            # Фильтры (ядро дублирует логику в core/filters)
│   ├── neural.ts             # Нейросеть (используется адаптером)
│   ├── admin.ts              # Админ-панель
│   ├── client.ts             # MTProto-клиент
│   ├── initUserbot.ts
│   ├── import_words.ts
│   ├── get_group_id.ts
│   └── handlers/             # Обработчики (постепенно переносятся в delivery)
├── dist/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
├── TEST_USERBOT.md
└── README.md
```

Корневой `README.md` (этот файл) лежит на уровень выше папки `BotAnti`.

---

## Бот vs Userbot

Кратко: **userbot** — только модерация в реальном времени (анализ по промпту и фильтрам, отсылка нарушений в `LOG_CHAT_IDS` и при необходимости в личку боту). **Админ-панель и импорт/анализ файлов — только в боте.** Подробная таблица и описание: [BotAnti/docs/BOT_VS_USERBOT.md](BotAnti/docs/BOT_VS_USERBOT.md).

---

## Разработка

### Скрипты

```bash
npm run dev          # Userbot с автоперезагрузкой (tsx src/index.ts)
npm run dev:bot      # Бот с автоперезагрузкой (tsx src/bot.ts)
npm run build        # Сборка (tsc)
npm start            # Запуск userbot (node dist/index.js)
npm run start:bot    # Запуск бота (node dist/bot.js)
npm run import:words # Импорт слов из .env в БД
npm run lint         # Проверка кода (ESLint)
npm run lint:fix     # Автоисправление по правилам ESLint
npm run test         # Тесты (Vitest)
npm run test:watch   # Тесты в режиме наблюдения
```

### Pre-commit хуки (Husky + lint-staged)

В корне репозитория (папка `botanti`) лежит свой `package.json` с Husky. Чтобы включить проверку перед коммитом:

```bash
# из корня репозитория (botanti)
npm install
```

После этого при каждом `git commit` для изменённых `*.ts` в папке `BotAnti` автоматически запускается `eslint --fix`. Конфиг lint-staged — в `BotAnti/package.json` (ключ `"lint-staged"`).

### Стек

- TypeScript, Grammy (бот), библиотека `telegram` (userbot)
- SQLite, Axios, Cheerio (парсинг HTML)
- ESLint + архитектурные правила (`import/no-restricted-paths`), Vitest для тестов

### Важно

1. **Права**: бот должен быть админом с правом удаления сообщений; userbot — участник чата с нужными правами.
2. **Логи**: настройте `LOG_CHAT_ID` для уведомлений о нарушениях.
3. **БД**: делайте резервные копии `database.db` (в Docker — том `botanti_data`).
4. **Нейросеть**: убедитесь, что API (Ollama и т.п.) доступен.

---

## Лицензия

ISC

**Версия**: 1.0.0  
**Обновление**: 2025
