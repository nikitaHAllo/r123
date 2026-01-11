#!/bin/bash
echo "🤖 Запускаю BotAnti в Docker..."
docker-compose up -d
echo "✅ Готово! Бот запущен."
echo "📋 Команды:"
echo "   Логи: docker-compose logs -f"
echo "   Остановить: docker-compose down"
echo "   Статус: docker-compose ps"