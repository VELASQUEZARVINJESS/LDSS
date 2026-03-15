update public.profiles
set
    barangay = nullif(
        btrim(
            regexp_replace(
                regexp_replace(coalesce(barangay, ''), '(?i)\mDAET\M', ' ', 'g'),
                '\s*,\s*',
                ', ',
                'g'
            ),
            ' ,'
        ),
        ''
    ),
    updated_at = timezone('utc', now())
where barangay is not null
  and upper(barangay) like '%DAET%';
