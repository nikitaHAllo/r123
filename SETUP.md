# Полная инструкция по запуску BotAnti

В этом файле — всё необходимое, чтобы установить и запустить проект (Docker или без Docker) и настроить `.env`.

---

## Запуск через Docker

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

Скопируйте пример и заполните (подробнее — раздел [Конфигурация](#конфигурация) ниже):

```bash
# Windows (cmd):
copy .env.example .env

# Linux / macOS:
cp .env.example .env
```

Для **Userbot** обязательны `API_ID`, `API_HASH` и `SESSION_STRING`.

- **Если используете тот же аккаунт, что и другой человек** — попросите у него готовые `API_ID`, `API_HASH` и `SESSION_STRING` и вставьте в `.env`. Регистрация в терминале не нужна.
- **Если настраиваете свой аккаунт впервые** — в Docker **нельзя** ввести телефон и код. Сначала запустите без Docker: `npm run dev`, введите телефон и код, скопируйте выведенную строку `SESSION_STRING=...` в `.env`, затем уже запускайте `docker-compose up -d`. Подробнее: [BotAnti/TEST_USERBOT.md](BotAnti/TEST_USERBOT.md).

### 4. Запустите контейнер

```bash
docker-compose up -d
```

### 5. Проверьте статус

```bash
docker-compose ps
```

Должны быть **Up** оба контейнера: **botanti-userbot** и **botanti-bot**.

По умолчанию `docker-compose up -d` запускает **оба** режима: userbot (модерация в реальном времени) и бота (админка, команды, анализ файлов). Общая БД у них одна (том `botanti_data`). В контейнерах автоматически задаётся `DB_PATH=/data/database.db`, поэтому настройки из админки (вкл/выкл фильтров, нейросети) подхватываются обоими.

**Нейросеть (Ollama) в Docker:** если Ollama запущен на хосте, в `.env` добавьте:
```env
OLLAMA_URL=http://host.docker.internal:11434/v1/chat/completions
```
На Linux может понадобиться в `docker-compose.yml` в оба сервиса добавить `extra_hosts: ["host.docker.internal:host-gateway"]`. Если Ollama на другой машине в сети — укажите её IP в `OLLAMA_URL`.

**Запустить только один режим:**
```bash
docker-compose up -d userbot    # только userbot
docker-compose up -d bot        # только бот (Grammy)
```

---

## Основные команды Docker

| Команда | Описание |
|---------|----------|
| `docker-compose up -d` | Запустить оба (userbot + бот) в фоне |
| `docker-compose up -d userbot` | Только userbot |
| `docker-compose up -d bot` | Только бот |
| `docker-compose down` | Остановить все |
| `docker-compose logs -f` | Логи всех контейнеров |
| `docker-compose logs -f userbot` | Логи только userbot |
| `docker-compose logs -f bot` | Логи только бота |
| `docker-compose ps` | Статус контейнеров |
| `docker-compose restart` | Перезапустить оба |
| `docker-compose logs --tail=50` | Последние 50 строк логов |

Запуск и проверка одной командой:

```bash
docker-compose up -d && docker-compose ps
```

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

3. Создайте `.env` (см. [Конфигурация](#конфигурация)).

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

# Разрешённые чаты (ID через запятую; пусто = все). Поддерживаются форматы -1001234567890 и -1234567890
ALLOWED_CHATS=-1001234567890,-1009876543210

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

Если какой-то канал/группа не обрабатывается, посмотрите логи userbot: при пропуске чата выводится  
`Пропуск чата (не в ALLOWED_CHATS): id=...` — добавьте этот `id` в `ALLOWED_CHATS` (в любом формате: с `-100` или без).
