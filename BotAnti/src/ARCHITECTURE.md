# Архитектура BotAnti: Clean Architecture + модульное ядро

## Структура

```
src/
├── core/                      # Ядро (не зависит от внешнего мира)
│   ├── entities/              # Message, Violation, Topic
│   ├── ports/                 # Интерфейсы: IDatabase, IAiProvider, ILogger, ISettings
│   ├── filters/               # keywordFilter — чистая логика фильтров
│   └── use-cases/             # moderateMessage, analyzeDocument
│
├── infrastructure/            # Адаптеры (реализации портов)
│   ├── config/                # envConfig — чтение .env
│   ├── database/              # sqlite — реализация IDatabase
│   ├── ai/                    # ollama — реализация IAiProvider
│   ├── logging/               # consoleLogger
│   ├── settings/              # stateSettingsAdapter — ISettings из state.ts
│   └── topics/                # topicsProvider — тематики нейросети
│
├── delivery/                  # Способы доставки (бот / userbot)
│   ├── common/                # adminPanel, keyboards
│   ├── bot/                   # Grammy: bot.ts, controllers/, middlewares/
│   └── userbot/               # MTProto: userbot.ts, client.ts, handlers/
│
├── shared/                    # Ошибки, утилиты
│   ├── errors/
│   └── utils/
│
├── index.ts                   # Точка входа Userbot
└── bot.ts                     # Точка входа Bot
```

## Правила зависимостей

| Разрешено | Запрещено |
|-----------|-----------|
| core → ports (интерфейсы), entities, filters | core → infrastructure |
| infrastructure → core (порты, сущности) | core → delivery |
| delivery → core (use-cases), infrastructure (адаптеры) | core → handlers |
| shared — используется всеми по необходимости | infrastructure → delivery/bot или delivery/userbot |
| | delivery/bot ↔ delivery/userbot |

Границы проверяются ESLint: `import/no-restricted-paths` в `.eslintrc.cjs`.

## Поток данных для модерации

1. **delivery** (бот или userbot) получает сообщение из Telegram.
2. Контроллер/обработчик вызывает **core/use-cases/moderateMessage** с текстом и зависимостями (settings, ai, topicsProvider, logger, words).
3. Use case использует:
   - **core/filters/keywordFilter** — чистая проверка по ключевым словам;
   - **infrastructure/ai/ollama** (через порт **IAiProvider**) — нейросеть;
   - настройки через порт **ISettings** (реализация — stateSettingsAdapter).
4. Результат `{ violation }` возвращается в delivery.
5. Контроллер при нарушении: логирование, при необходимости `ctx.deleteMessage()` / отправка в LOG_CHAT_ID.

Пока часть обработчиков ещё вызывает напрямую `filters.ts`, `neural.ts`, `state.ts`; цель — постепенно перевести их на вызов use-case с внедрёнными портами.

## План миграции (убрать дублирование из корня)

| Старый файл | Целевой слой | Действия |
|-------------|--------------|----------|
| `filters.ts` | `core/filters/keywordFilter.ts` | Вызывать use-case или keywordFilter с передачей слов из БД; старый файл — реэкспорт или deprecated |
| `neural.ts` | `infrastructure/ai/ollama.ts` | Адаптер уже есть; вызовы перевести на IAiProvider |
| `state.ts` | `infrastructure/settings/stateSettingsAdapter.ts` | Настройки через ISettings; state — тонкая обёртка или удаление после миграции |
| `admin.ts` | `delivery/common/adminPanel.ts` | Логику перенести в delivery/common; admin.ts — реэкспорт |
| `handlers/*` | `delivery/bot/controllers/*`, `delivery/userbot/handlers/*` | Постепенно переносить код в delivery, оставляя в handlers только реэкспорты |

Рекомендуемый порядок:

1. Отметить старые файлы комментарием `@deprecated` и указать замену.
2. Перенаправить новые импорты на слои (core, infrastructure, delivery).
3. После прогона тестов и линта удалить устаревший код.

## Использование ядра

- **moderateMessage** (use-case): принимает текст, слова фильтров и зависимости (settings, ai, topicsProvider, logger); возвращает `{ violation }` или `{ violation: null }`.
- **analyzeDocument** (use-case): принимает массив сообщений и функцию модерации одного сообщения; возвращает отчёт о нарушениях.

Контроллеры и обработчики могут постепенно переходить на вызов этих use-cases вместо прямой работы с `filters`, `neural`, `state`.
