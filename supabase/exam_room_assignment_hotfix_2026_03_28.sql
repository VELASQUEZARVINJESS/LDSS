alter table public.exam_records
    add column if not exists room_label text,
    add column if not exists room_seat_no integer;

create index if not exists idx_exam_records_batch_room_label
    on public.exam_records (batch_id, room_label, room_seat_no);
