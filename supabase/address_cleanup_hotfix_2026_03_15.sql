create or replace function public.ldss_clean_profile_address(p_address text, p_barangay text)
returns text
language plpgsql
immutable
as $$
declare
    cleaned text := coalesce(p_address, '');
    selected_barangay text := nullif(trim(coalesce(p_barangay, '')), '');
    escaped_barangay text;
begin
    cleaned := regexp_replace(cleaned, '\s*,\s*', ', ', 'g');
    cleaned := regexp_replace(cleaned, ',\s*,+', ', ', 'g');
    cleaned := regexp_replace(cleaned, '\s{2,}', ' ', 'g');
    cleaned := btrim(cleaned, ' ,');

    cleaned := regexp_replace(cleaned, '(?i)\mDAET\M', ' ', 'g');

    if selected_barangay is not null then
        escaped_barangay := regexp_replace(selected_barangay, '([\\.^$|?*+(){}\[\]])', '\\\1', 'g');
        escaped_barangay := replace(escaped_barangay, ' ', '\s+');
        cleaned := regexp_replace(cleaned, '(?i)\m' || escaped_barangay || '\M', ' ', 'g');
    end if;

    cleaned := regexp_replace(cleaned, '\s*,\s*', ', ', 'g');
    cleaned := regexp_replace(cleaned, ',\s*,+', ', ', 'g');
    cleaned := regexp_replace(cleaned, '\s{2,}', ' ', 'g');
    cleaned := btrim(cleaned, ' ,');

    if cleaned = '' then
        if selected_barangay is null then
            return null;
        end if;
        return upper(selected_barangay) || ', DAET';
    end if;

    if selected_barangay is null then
        return cleaned || ', DAET';
    end if;

    return cleaned || ', ' || upper(selected_barangay) || ', DAET';
end;
$$;

update public.profiles
set
    address = public.ldss_clean_profile_address(address, barangay),
    updated_at = timezone('utc', now())
where address is not null
  and (
    upper(address) like '%DAET%'
    or (barangay is not null and upper(address) like '%' || upper(barangay) || '%')
  );
