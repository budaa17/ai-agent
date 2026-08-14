# ADR 0005: pg-boss ба RabbitMQ-ийн boundary

- Төлөв: Accepted
- Огноо: 2026-07-29

## Нөхцөл

Одоогийн агентууд PostgreSQL-д суурилсан `pg-boss` queue ашигладаг. Шаардлагад RabbitMQ дурдагдсан ч хоёр queue-г зэрэг production-critical болгох нь давхардсан retry, routing, operational complexity үүсгэнэ.

## Шийдвэр

- Phase 1–2-т agent job execution-д `pg-boss`-ийг canonical queue хэвээр хэрэглэнэ.
- Domain event contract нь broker-оос хамаарахгүй `AgentEventV1` байна.
- Phase 4 backend outbox нь PostgreSQL transaction-аас event гаргана.
- RabbitMQ-г гаднын системийн integration, fan-out шаардлага бодитоор батлагдсан үед adapter хэлбэрээр нэмнэ.
- Нэг job/event-ийн idempotency key хоёр broker дамжсан ч ижил байна.

## Үр дагавар

- Одоогийн worker-үүдийг дахин бичихгүй.
- Нэг transactional database-аар local queue consistency хадгална.
- RabbitMQ нь Phase 1-ийн completion blocker биш.
