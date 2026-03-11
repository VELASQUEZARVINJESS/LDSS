-- Allow both legacy applicant upload paths and the new uploads/<document_type>/... layout.

drop policy if exists ldss_documents_select_owner_or_staff on storage.objects;
create policy ldss_documents_select_owner_or_staff
on storage.objects
for select
to authenticated
using (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (storage.foldername(name))[2] = auth.uid()::text
        or (storage.foldername(name))[3] = auth.uid()::text
    )
);

drop policy if exists ldss_documents_insert_owner_or_staff on storage.objects;
create policy ldss_documents_insert_owner_or_staff
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (
            public.current_user_role() = 'applicant'
            and (
                (storage.foldername(name))[2] = auth.uid()::text
                or (storage.foldername(name))[3] = auth.uid()::text
            )
        )
    )
);

drop policy if exists ldss_documents_update_owner_or_staff on storage.objects;
create policy ldss_documents_update_owner_or_staff
on storage.objects
for update
to authenticated
using (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (storage.foldername(name))[2] = auth.uid()::text
        or (storage.foldername(name))[3] = auth.uid()::text
    )
)
with check (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (storage.foldername(name))[2] = auth.uid()::text
        or (storage.foldername(name))[3] = auth.uid()::text
    )
);

drop policy if exists ldss_documents_delete_owner_or_staff on storage.objects;
create policy ldss_documents_delete_owner_or_staff
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (storage.foldername(name))[2] = auth.uid()::text
        or (storage.foldername(name))[3] = auth.uid()::text
    )
);
