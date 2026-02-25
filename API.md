# FunPayServer REST API

## Авторизация

Все запросы требуют заголовок `X-API-Key` с ключом, указанным в `settings.txt`.

```
X-API-Key: ваш_секретный_ключ
```

## Эндпоинты

### `GET /api/status`
Статус бота, uptime, RAM, ошибки.

```bash
curl -H "X-API-Key: YOUR_KEY" http://localhost:3002/api/status
```
```json
{
  "status": "ok",
  "uptime": 3600,
  "ram": "45.2 MB",
  "errors": 0,
  "account": "UserName",
  "version": "0.7.5"
}
```

---

### `GET /api/balance`
Текущий баланс и история (последние 24 точки).

```bash
curl -H "X-API-Key: YOUR_KEY" http://localhost:3002/api/balance
```
```json
{
  "balance": "1234.56",
  "history": [
    { "t": 1708900000000, "v": 1200 },
    { "t": 1708903600000, "v": 1234.56 }
  ]
}
```

---

### `GET /api/orders`
Статистика выдач за сессию.

```bash
curl -H "X-API-Key: YOUR_KEY" http://localhost:3002/api/orders
```
```json
{
  "delivered": 15,
  "totalValue": 4500,
  "orders": []
}
```

---

### `GET /api/stock`
Остатки товаров на автовыдаче.

```bash
curl -H "X-API-Key: YOUR_KEY" http://localhost:3002/api/stock
```
```json
{
  "stock": [
    { "name": "Аккаунт Steam", "count": 12 },
    { "name": "VPN ключ", "count": "∞" }
  ]
}
```

## Порт

По умолчанию: `3002`. Можно задать через `apiPort` в `settings.txt`.

## Ошибки

| Код | Описание |
|-----|----------|
| 401 | Неверный или отсутствующий API-ключ |
| 404 | Эндпоинт не найден |
| 500 | Внутренняя ошибка сервера |
