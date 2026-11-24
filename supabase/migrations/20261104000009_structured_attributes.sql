-- ============================================================================
-- Structured attribute values
--
-- Attributes whose values are a known, closed set become dropdowns
-- (type 'enum' with admin-managed options, Arabic + English). Sellers pick
-- from the list; admins can extend it in Admin → Catalog → Attributes.
--   * country / made_in → every country (ISO 3166), searchable, A–Z
--   * material family, pattern, fit, occasion, age groups, sizing system,
--     sleeve length, closure, power source, energy rating, skin type,
--     product form → curated lists (with "Other" where the set is open-ended)
--   * fragrance_free / dishwasher_safe / automatic_shut_off → yes/no
-- Free text stays where values are genuinely open (model, weight,
-- dimensions, ingredients, flavour…). Existing answers are matched to the
-- new options by their Arabic or English label; unmatched text is kept.
-- ============================================================================
begin;

-- country → countries
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'country' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('af', 'Afghanistan', 'أفغانستان', 0),
    ('al', 'Albania', 'ألبانيا', 1),
    ('dz', 'Algeria', 'الجزائر', 2),
    ('ad', 'Andorra', 'أندورا', 3),
    ('ao', 'Angola', 'أنغولا', 4),
    ('ag', 'Antigua and Barbuda', 'أنتيغوا وباربودا', 5),
    ('ar', 'Argentina', 'الأرجنتين', 6),
    ('am', 'Armenia', 'أرمينيا', 7),
    ('au', 'Australia', 'أستراليا', 8),
    ('at', 'Austria', 'النمسا', 9),
    ('az', 'Azerbaijan', 'أذربيجان', 10),
    ('bs', 'Bahamas', 'جزر البهاما', 11),
    ('bh', 'Bahrain', 'البحرين', 12),
    ('bd', 'Bangladesh', 'بنغلاديش', 13),
    ('bb', 'Barbados', 'باربادوس', 14),
    ('by', 'Belarus', 'بيلاروسيا', 15),
    ('be', 'Belgium', 'بلجيكا', 16),
    ('bz', 'Belize', 'بليز', 17),
    ('bj', 'Benin', 'بنين', 18),
    ('bt', 'Bhutan', 'بوتان', 19),
    ('bo', 'Bolivia', 'بوليفيا', 20),
    ('ba', 'Bosnia and Herzegovina', 'البوسنة والهرسك', 21),
    ('bw', 'Botswana', 'بوتسوانا', 22),
    ('br', 'Brazil', 'البرازيل', 23),
    ('bn', 'Brunei', 'بروناي', 24),
    ('bg', 'Bulgaria', 'بلغاريا', 25),
    ('bf', 'Burkina Faso', 'بوركينا فاسو', 26),
    ('bi', 'Burundi', 'بوروندي', 27),
    ('cv', 'Cabo Verde', 'الرأس الأخضر', 28),
    ('kh', 'Cambodia', 'كمبوديا', 29),
    ('cm', 'Cameroon', 'الكاميرون', 30),
    ('ca', 'Canada', 'كندا', 31),
    ('cf', 'Central African Republic', 'جمهورية أفريقيا الوسطى', 32),
    ('td', 'Chad', 'تشاد', 33),
    ('cl', 'Chile', 'تشيلي', 34),
    ('cn', 'China', 'الصين', 35),
    ('co', 'Colombia', 'كولومبيا', 36),
    ('km', 'Comoros', 'جزر القمر', 37),
    ('cg', 'Congo', 'الكونغو', 38),
    ('cd', 'Congo (DR)', 'الكونغو الديمقراطية', 39),
    ('cr', 'Costa Rica', 'كوستاريكا', 40),
    ('hr', 'Croatia', 'كرواتيا', 41),
    ('cu', 'Cuba', 'كوبا', 42),
    ('cy', 'Cyprus', 'قبرص', 43),
    ('cz', 'Czechia', 'التشيك', 44),
    ('ci', 'Côte d''Ivoire', 'ساحل العاج', 45),
    ('dk', 'Denmark', 'الدنمارك', 46),
    ('dj', 'Djibouti', 'جيبوتي', 47),
    ('dm', 'Dominica', 'دومينيكا', 48),
    ('do', 'Dominican Republic', 'جمهورية الدومينيكان', 49),
    ('ec', 'Ecuador', 'الإكوادور', 50),
    ('eg', 'Egypt', 'مصر', 51),
    ('sv', 'El Salvador', 'السلفادور', 52),
    ('gq', 'Equatorial Guinea', 'غينيا الاستوائية', 53),
    ('er', 'Eritrea', 'إريتريا', 54),
    ('ee', 'Estonia', 'إستونيا', 55),
    ('sz', 'Eswatini', 'إسواتيني', 56),
    ('et', 'Ethiopia', 'إثيوبيا', 57),
    ('fj', 'Fiji', 'فيجي', 58),
    ('fi', 'Finland', 'فنلندا', 59),
    ('fr', 'France', 'فرنسا', 60),
    ('ga', 'Gabon', 'الغابون', 61),
    ('gm', 'Gambia', 'غامبيا', 62),
    ('ge', 'Georgia', 'جورجيا', 63),
    ('de', 'Germany', 'ألمانيا', 64),
    ('gh', 'Ghana', 'غانا', 65),
    ('gr', 'Greece', 'اليونان', 66),
    ('gd', 'Grenada', 'غرينادا', 67),
    ('gt', 'Guatemala', 'غواتيمالا', 68),
    ('gn', 'Guinea', 'غينيا', 69),
    ('gw', 'Guinea-Bissau', 'غينيا بيساو', 70),
    ('gy', 'Guyana', 'غيانا', 71),
    ('ht', 'Haiti', 'هايتي', 72),
    ('hn', 'Honduras', 'هندوراس', 73),
    ('hk', 'Hong Kong', 'هونغ كونغ', 74),
    ('hu', 'Hungary', 'المجر', 75),
    ('is', 'Iceland', 'آيسلندا', 76),
    ('in', 'India', 'الهند', 77),
    ('id', 'Indonesia', 'إندونيسيا', 78),
    ('ir', 'Iran', 'إيران', 79),
    ('iq', 'Iraq', 'العراق', 80),
    ('ie', 'Ireland', 'أيرلندا', 81),
    ('it', 'Italy', 'إيطاليا', 82),
    ('jm', 'Jamaica', 'جامايكا', 83),
    ('jp', 'Japan', 'اليابان', 84),
    ('jo', 'Jordan', 'الأردن', 85),
    ('kz', 'Kazakhstan', 'كازاخستان', 86),
    ('ke', 'Kenya', 'كينيا', 87),
    ('ki', 'Kiribati', 'كيريباتي', 88),
    ('kw', 'Kuwait', 'الكويت', 89),
    ('kg', 'Kyrgyzstan', 'قيرغيزستان', 90),
    ('la', 'Laos', 'لاوس', 91),
    ('lv', 'Latvia', 'لاتفيا', 92),
    ('lb', 'Lebanon', 'لبنان', 93),
    ('ls', 'Lesotho', 'ليسوتو', 94),
    ('lr', 'Liberia', 'ليبيريا', 95),
    ('ly', 'Libya', 'ليبيا', 96),
    ('li', 'Liechtenstein', 'ليختنشتاين', 97),
    ('lt', 'Lithuania', 'ليتوانيا', 98),
    ('lu', 'Luxembourg', 'لوكسمبورغ', 99),
    ('mo', 'Macao', 'ماكاو', 100),
    ('mg', 'Madagascar', 'مدغشقر', 101),
    ('mw', 'Malawi', 'مالاوي', 102),
    ('my', 'Malaysia', 'ماليزيا', 103),
    ('mv', 'Maldives', 'جزر المالديف', 104),
    ('ml', 'Mali', 'مالي', 105),
    ('mt', 'Malta', 'مالطا', 106),
    ('mh', 'Marshall Islands', 'جزر مارشال', 107),
    ('mr', 'Mauritania', 'موريتانيا', 108),
    ('mu', 'Mauritius', 'موريشيوس', 109),
    ('mx', 'Mexico', 'المكسيك', 110),
    ('fm', 'Micronesia', 'ميكرونيزيا', 111),
    ('md', 'Moldova', 'مولدوفا', 112),
    ('mc', 'Monaco', 'موناكو', 113),
    ('mn', 'Mongolia', 'منغوليا', 114),
    ('me', 'Montenegro', 'الجبل الأسود', 115),
    ('ma', 'Morocco', 'المغرب', 116),
    ('mz', 'Mozambique', 'موزمبيق', 117),
    ('mm', 'Myanmar', 'ميانمار', 118),
    ('na', 'Namibia', 'ناميبيا', 119),
    ('nr', 'Nauru', 'ناورو', 120),
    ('np', 'Nepal', 'نيبال', 121),
    ('nl', 'Netherlands', 'هولندا', 122),
    ('nz', 'New Zealand', 'نيوزيلندا', 123),
    ('ni', 'Nicaragua', 'نيكاراغوا', 124),
    ('ne', 'Niger', 'النيجر', 125),
    ('ng', 'Nigeria', 'نيجيريا', 126),
    ('kp', 'North Korea', 'كوريا الشمالية', 127),
    ('mk', 'North Macedonia', 'مقدونيا الشمالية', 128),
    ('no', 'Norway', 'النرويج', 129),
    ('om', 'Oman', 'عُمان', 130),
    ('pk', 'Pakistan', 'باكستان', 131),
    ('pw', 'Palau', 'بالاو', 132),
    ('ps', 'Palestine', 'فلسطين', 133),
    ('pa', 'Panama', 'بنما', 134),
    ('pg', 'Papua New Guinea', 'بابوا غينيا الجديدة', 135),
    ('py', 'Paraguay', 'باراغواي', 136),
    ('pe', 'Peru', 'بيرو', 137),
    ('ph', 'Philippines', 'الفلبين', 138),
    ('pl', 'Poland', 'بولندا', 139),
    ('pt', 'Portugal', 'البرتغال', 140),
    ('qa', 'Qatar', 'قطر', 141),
    ('ro', 'Romania', 'رومانيا', 142),
    ('ru', 'Russia', 'روسيا', 143),
    ('rw', 'Rwanda', 'رواندا', 144),
    ('kn', 'Saint Kitts and Nevis', 'سانت كيتس ونيفيس', 145),
    ('lc', 'Saint Lucia', 'سانت لوسيا', 146),
    ('vc', 'Saint Vincent and the Grenadines', 'سانت فنسنت والغرينادين', 147),
    ('ws', 'Samoa', 'ساموا', 148),
    ('sm', 'San Marino', 'سان مارينو', 149),
    ('sa', 'Saudi Arabia', 'السعودية', 150),
    ('sn', 'Senegal', 'السنغال', 151),
    ('rs', 'Serbia', 'صربيا', 152),
    ('sc', 'Seychelles', 'سيشل', 153),
    ('sl', 'Sierra Leone', 'سيراليون', 154),
    ('sg', 'Singapore', 'سنغافورة', 155),
    ('sk', 'Slovakia', 'سلوفاكيا', 156),
    ('si', 'Slovenia', 'سلوفينيا', 157),
    ('sb', 'Solomon Islands', 'جزر سليمان', 158),
    ('so', 'Somalia', 'الصومال', 159),
    ('za', 'South Africa', 'جنوب أفريقيا', 160),
    ('kr', 'South Korea', 'كوريا الجنوبية', 161),
    ('ss', 'South Sudan', 'جنوب السودان', 162),
    ('es', 'Spain', 'إسبانيا', 163),
    ('lk', 'Sri Lanka', 'سريلانكا', 164),
    ('sd', 'Sudan', 'السودان', 165),
    ('sr', 'Suriname', 'سورينام', 166),
    ('se', 'Sweden', 'السويد', 167),
    ('ch', 'Switzerland', 'سويسرا', 168),
    ('sy', 'Syria', 'سوريا', 169),
    ('st', 'São Tomé and Príncipe', 'ساو تومي وبرينسيبي', 170),
    ('tw', 'Taiwan', 'تايوان', 171),
    ('tj', 'Tajikistan', 'طاجيكستان', 172),
    ('tz', 'Tanzania', 'تنزانيا', 173),
    ('th', 'Thailand', 'تايلاند', 174),
    ('tl', 'Timor-Leste', 'تيمور الشرقية', 175),
    ('tg', 'Togo', 'توغو', 176),
    ('to', 'Tonga', 'تونغا', 177),
    ('tt', 'Trinidad and Tobago', 'ترينيداد وتوباغو', 178),
    ('tn', 'Tunisia', 'تونس', 179),
    ('tm', 'Turkmenistan', 'تركمانستان', 180),
    ('tv', 'Tuvalu', 'توفالو', 181),
    ('tr', 'Türkiye', 'تركيا', 182),
    ('ug', 'Uganda', 'أوغندا', 183),
    ('ua', 'Ukraine', 'أوكرانيا', 184),
    ('ae', 'United Arab Emirates', 'الإمارات', 185),
    ('gb', 'United Kingdom', 'المملكة المتحدة', 186),
    ('us', 'United States', 'الولايات المتحدة', 187),
    ('uy', 'Uruguay', 'الأوروغواي', 188),
    ('uz', 'Uzbekistan', 'أوزبكستان', 189),
    ('vu', 'Vanuatu', 'فانواتو', 190),
    ('va', 'Vatican City', 'الفاتيكان', 191),
    ('ve', 'Venezuela', 'فنزويلا', 192),
    ('vn', 'Vietnam', 'فيتنام', 193),
    ('ye', 'Yemen', 'اليمن', 194),
    ('zm', 'Zambia', 'زامبيا', 195),
    ('zw', 'Zimbabwe', 'زيمبابوي', 196)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- made_in → countries
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'made_in' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('af', 'Afghanistan', 'أفغانستان', 0),
    ('al', 'Albania', 'ألبانيا', 1),
    ('dz', 'Algeria', 'الجزائر', 2),
    ('ad', 'Andorra', 'أندورا', 3),
    ('ao', 'Angola', 'أنغولا', 4),
    ('ag', 'Antigua and Barbuda', 'أنتيغوا وباربودا', 5),
    ('ar', 'Argentina', 'الأرجنتين', 6),
    ('am', 'Armenia', 'أرمينيا', 7),
    ('au', 'Australia', 'أستراليا', 8),
    ('at', 'Austria', 'النمسا', 9),
    ('az', 'Azerbaijan', 'أذربيجان', 10),
    ('bs', 'Bahamas', 'جزر البهاما', 11),
    ('bh', 'Bahrain', 'البحرين', 12),
    ('bd', 'Bangladesh', 'بنغلاديش', 13),
    ('bb', 'Barbados', 'باربادوس', 14),
    ('by', 'Belarus', 'بيلاروسيا', 15),
    ('be', 'Belgium', 'بلجيكا', 16),
    ('bz', 'Belize', 'بليز', 17),
    ('bj', 'Benin', 'بنين', 18),
    ('bt', 'Bhutan', 'بوتان', 19),
    ('bo', 'Bolivia', 'بوليفيا', 20),
    ('ba', 'Bosnia and Herzegovina', 'البوسنة والهرسك', 21),
    ('bw', 'Botswana', 'بوتسوانا', 22),
    ('br', 'Brazil', 'البرازيل', 23),
    ('bn', 'Brunei', 'بروناي', 24),
    ('bg', 'Bulgaria', 'بلغاريا', 25),
    ('bf', 'Burkina Faso', 'بوركينا فاسو', 26),
    ('bi', 'Burundi', 'بوروندي', 27),
    ('cv', 'Cabo Verde', 'الرأس الأخضر', 28),
    ('kh', 'Cambodia', 'كمبوديا', 29),
    ('cm', 'Cameroon', 'الكاميرون', 30),
    ('ca', 'Canada', 'كندا', 31),
    ('cf', 'Central African Republic', 'جمهورية أفريقيا الوسطى', 32),
    ('td', 'Chad', 'تشاد', 33),
    ('cl', 'Chile', 'تشيلي', 34),
    ('cn', 'China', 'الصين', 35),
    ('co', 'Colombia', 'كولومبيا', 36),
    ('km', 'Comoros', 'جزر القمر', 37),
    ('cg', 'Congo', 'الكونغو', 38),
    ('cd', 'Congo (DR)', 'الكونغو الديمقراطية', 39),
    ('cr', 'Costa Rica', 'كوستاريكا', 40),
    ('hr', 'Croatia', 'كرواتيا', 41),
    ('cu', 'Cuba', 'كوبا', 42),
    ('cy', 'Cyprus', 'قبرص', 43),
    ('cz', 'Czechia', 'التشيك', 44),
    ('ci', 'Côte d''Ivoire', 'ساحل العاج', 45),
    ('dk', 'Denmark', 'الدنمارك', 46),
    ('dj', 'Djibouti', 'جيبوتي', 47),
    ('dm', 'Dominica', 'دومينيكا', 48),
    ('do', 'Dominican Republic', 'جمهورية الدومينيكان', 49),
    ('ec', 'Ecuador', 'الإكوادور', 50),
    ('eg', 'Egypt', 'مصر', 51),
    ('sv', 'El Salvador', 'السلفادور', 52),
    ('gq', 'Equatorial Guinea', 'غينيا الاستوائية', 53),
    ('er', 'Eritrea', 'إريتريا', 54),
    ('ee', 'Estonia', 'إستونيا', 55),
    ('sz', 'Eswatini', 'إسواتيني', 56),
    ('et', 'Ethiopia', 'إثيوبيا', 57),
    ('fj', 'Fiji', 'فيجي', 58),
    ('fi', 'Finland', 'فنلندا', 59),
    ('fr', 'France', 'فرنسا', 60),
    ('ga', 'Gabon', 'الغابون', 61),
    ('gm', 'Gambia', 'غامبيا', 62),
    ('ge', 'Georgia', 'جورجيا', 63),
    ('de', 'Germany', 'ألمانيا', 64),
    ('gh', 'Ghana', 'غانا', 65),
    ('gr', 'Greece', 'اليونان', 66),
    ('gd', 'Grenada', 'غرينادا', 67),
    ('gt', 'Guatemala', 'غواتيمالا', 68),
    ('gn', 'Guinea', 'غينيا', 69),
    ('gw', 'Guinea-Bissau', 'غينيا بيساو', 70),
    ('gy', 'Guyana', 'غيانا', 71),
    ('ht', 'Haiti', 'هايتي', 72),
    ('hn', 'Honduras', 'هندوراس', 73),
    ('hk', 'Hong Kong', 'هونغ كونغ', 74),
    ('hu', 'Hungary', 'المجر', 75),
    ('is', 'Iceland', 'آيسلندا', 76),
    ('in', 'India', 'الهند', 77),
    ('id', 'Indonesia', 'إندونيسيا', 78),
    ('ir', 'Iran', 'إيران', 79),
    ('iq', 'Iraq', 'العراق', 80),
    ('ie', 'Ireland', 'أيرلندا', 81),
    ('it', 'Italy', 'إيطاليا', 82),
    ('jm', 'Jamaica', 'جامايكا', 83),
    ('jp', 'Japan', 'اليابان', 84),
    ('jo', 'Jordan', 'الأردن', 85),
    ('kz', 'Kazakhstan', 'كازاخستان', 86),
    ('ke', 'Kenya', 'كينيا', 87),
    ('ki', 'Kiribati', 'كيريباتي', 88),
    ('kw', 'Kuwait', 'الكويت', 89),
    ('kg', 'Kyrgyzstan', 'قيرغيزستان', 90),
    ('la', 'Laos', 'لاوس', 91),
    ('lv', 'Latvia', 'لاتفيا', 92),
    ('lb', 'Lebanon', 'لبنان', 93),
    ('ls', 'Lesotho', 'ليسوتو', 94),
    ('lr', 'Liberia', 'ليبيريا', 95),
    ('ly', 'Libya', 'ليبيا', 96),
    ('li', 'Liechtenstein', 'ليختنشتاين', 97),
    ('lt', 'Lithuania', 'ليتوانيا', 98),
    ('lu', 'Luxembourg', 'لوكسمبورغ', 99),
    ('mo', 'Macao', 'ماكاو', 100),
    ('mg', 'Madagascar', 'مدغشقر', 101),
    ('mw', 'Malawi', 'مالاوي', 102),
    ('my', 'Malaysia', 'ماليزيا', 103),
    ('mv', 'Maldives', 'جزر المالديف', 104),
    ('ml', 'Mali', 'مالي', 105),
    ('mt', 'Malta', 'مالطا', 106),
    ('mh', 'Marshall Islands', 'جزر مارشال', 107),
    ('mr', 'Mauritania', 'موريتانيا', 108),
    ('mu', 'Mauritius', 'موريشيوس', 109),
    ('mx', 'Mexico', 'المكسيك', 110),
    ('fm', 'Micronesia', 'ميكرونيزيا', 111),
    ('md', 'Moldova', 'مولدوفا', 112),
    ('mc', 'Monaco', 'موناكو', 113),
    ('mn', 'Mongolia', 'منغوليا', 114),
    ('me', 'Montenegro', 'الجبل الأسود', 115),
    ('ma', 'Morocco', 'المغرب', 116),
    ('mz', 'Mozambique', 'موزمبيق', 117),
    ('mm', 'Myanmar', 'ميانمار', 118),
    ('na', 'Namibia', 'ناميبيا', 119),
    ('nr', 'Nauru', 'ناورو', 120),
    ('np', 'Nepal', 'نيبال', 121),
    ('nl', 'Netherlands', 'هولندا', 122),
    ('nz', 'New Zealand', 'نيوزيلندا', 123),
    ('ni', 'Nicaragua', 'نيكاراغوا', 124),
    ('ne', 'Niger', 'النيجر', 125),
    ('ng', 'Nigeria', 'نيجيريا', 126),
    ('kp', 'North Korea', 'كوريا الشمالية', 127),
    ('mk', 'North Macedonia', 'مقدونيا الشمالية', 128),
    ('no', 'Norway', 'النرويج', 129),
    ('om', 'Oman', 'عُمان', 130),
    ('pk', 'Pakistan', 'باكستان', 131),
    ('pw', 'Palau', 'بالاو', 132),
    ('ps', 'Palestine', 'فلسطين', 133),
    ('pa', 'Panama', 'بنما', 134),
    ('pg', 'Papua New Guinea', 'بابوا غينيا الجديدة', 135),
    ('py', 'Paraguay', 'باراغواي', 136),
    ('pe', 'Peru', 'بيرو', 137),
    ('ph', 'Philippines', 'الفلبين', 138),
    ('pl', 'Poland', 'بولندا', 139),
    ('pt', 'Portugal', 'البرتغال', 140),
    ('qa', 'Qatar', 'قطر', 141),
    ('ro', 'Romania', 'رومانيا', 142),
    ('ru', 'Russia', 'روسيا', 143),
    ('rw', 'Rwanda', 'رواندا', 144),
    ('kn', 'Saint Kitts and Nevis', 'سانت كيتس ونيفيس', 145),
    ('lc', 'Saint Lucia', 'سانت لوسيا', 146),
    ('vc', 'Saint Vincent and the Grenadines', 'سانت فنسنت والغرينادين', 147),
    ('ws', 'Samoa', 'ساموا', 148),
    ('sm', 'San Marino', 'سان مارينو', 149),
    ('sa', 'Saudi Arabia', 'السعودية', 150),
    ('sn', 'Senegal', 'السنغال', 151),
    ('rs', 'Serbia', 'صربيا', 152),
    ('sc', 'Seychelles', 'سيشل', 153),
    ('sl', 'Sierra Leone', 'سيراليون', 154),
    ('sg', 'Singapore', 'سنغافورة', 155),
    ('sk', 'Slovakia', 'سلوفاكيا', 156),
    ('si', 'Slovenia', 'سلوفينيا', 157),
    ('sb', 'Solomon Islands', 'جزر سليمان', 158),
    ('so', 'Somalia', 'الصومال', 159),
    ('za', 'South Africa', 'جنوب أفريقيا', 160),
    ('kr', 'South Korea', 'كوريا الجنوبية', 161),
    ('ss', 'South Sudan', 'جنوب السودان', 162),
    ('es', 'Spain', 'إسبانيا', 163),
    ('lk', 'Sri Lanka', 'سريلانكا', 164),
    ('sd', 'Sudan', 'السودان', 165),
    ('sr', 'Suriname', 'سورينام', 166),
    ('se', 'Sweden', 'السويد', 167),
    ('ch', 'Switzerland', 'سويسرا', 168),
    ('sy', 'Syria', 'سوريا', 169),
    ('st', 'São Tomé and Príncipe', 'ساو تومي وبرينسيبي', 170),
    ('tw', 'Taiwan', 'تايوان', 171),
    ('tj', 'Tajikistan', 'طاجيكستان', 172),
    ('tz', 'Tanzania', 'تنزانيا', 173),
    ('th', 'Thailand', 'تايلاند', 174),
    ('tl', 'Timor-Leste', 'تيمور الشرقية', 175),
    ('tg', 'Togo', 'توغو', 176),
    ('to', 'Tonga', 'تونغا', 177),
    ('tt', 'Trinidad and Tobago', 'ترينيداد وتوباغو', 178),
    ('tn', 'Tunisia', 'تونس', 179),
    ('tm', 'Turkmenistan', 'تركمانستان', 180),
    ('tv', 'Tuvalu', 'توفالو', 181),
    ('tr', 'Türkiye', 'تركيا', 182),
    ('ug', 'Uganda', 'أوغندا', 183),
    ('ua', 'Ukraine', 'أوكرانيا', 184),
    ('ae', 'United Arab Emirates', 'الإمارات', 185),
    ('gb', 'United Kingdom', 'المملكة المتحدة', 186),
    ('us', 'United States', 'الولايات المتحدة', 187),
    ('uy', 'Uruguay', 'الأوروغواي', 188),
    ('uz', 'Uzbekistan', 'أوزبكستان', 189),
    ('vu', 'Vanuatu', 'فانواتو', 190),
    ('va', 'Vatican City', 'الفاتيكان', 191),
    ('ve', 'Venezuela', 'فنزويلا', 192),
    ('vn', 'Vietnam', 'فيتنام', 193),
    ('ye', 'Yemen', 'اليمن', 194),
    ('zm', 'Zambia', 'زامبيا', 195),
    ('zw', 'Zimbabwe', 'زيمبابوي', 196)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- material → materials
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'material' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('cotton', 'Cotton', 'قطن', 0),
    ('polyester', 'Polyester', 'بوليستر', 1),
    ('cotton_blend', 'Cotton blend', 'قطن مخلوط', 2),
    ('linen', 'Linen', 'كتان', 3),
    ('wool', 'Wool', 'صوف', 4),
    ('silk', 'Silk', 'حرير', 5),
    ('denim', 'Denim', 'جينز (دنيم)', 6),
    ('leather', 'Genuine leather', 'جلد طبيعي', 7),
    ('faux_leather', 'Faux leather', 'جلد صناعي', 8),
    ('suede', 'Suede', 'شامواه', 9),
    ('nylon', 'Nylon', 'نايلون', 10),
    ('elastane', 'Elastane / Spandex', 'إيلاستين / سباندكس', 11),
    ('viscose', 'Viscose / Rayon', 'فسكوز / رايون', 12),
    ('acrylic', 'Acrylic', 'أكريليك', 13),
    ('fleece', 'Fleece', 'فليس', 14),
    ('velvet', 'Velvet', 'قطيفة', 15),
    ('satin', 'Satin', 'ساتان', 16),
    ('chiffon', 'Chiffon', 'شيفون', 17),
    ('knit', 'Knit', 'تريكو', 18),
    ('canvas', 'Canvas', 'كانفاس', 19),
    ('rubber', 'Rubber', 'مطاط', 20),
    ('eva', 'EVA foam', 'إسفنج EVA', 21),
    ('plastic', 'Plastic', 'بلاستيك', 22),
    ('abs', 'ABS plastic', 'بلاستيك ABS', 23),
    ('silicone', 'Silicone', 'سيليكون', 24),
    ('metal', 'Metal', 'معدن', 25),
    ('stainless_steel', 'Stainless steel', 'ستانلس ستيل', 26),
    ('aluminum', 'Aluminum', 'ألومنيوم', 27),
    ('iron', 'Iron', 'حديد', 28),
    ('copper', 'Copper', 'نحاس', 29),
    ('brass', 'Brass', 'نحاس أصفر', 30),
    ('gold', 'Gold', 'ذهب', 31),
    ('silver', 'Silver', 'فضة', 32),
    ('glass', 'Glass', 'زجاج', 33),
    ('tempered_glass', 'Tempered glass', 'زجاج مقسّى', 34),
    ('ceramic', 'Ceramic', 'سيراميك', 35),
    ('porcelain', 'Porcelain', 'بورسلين', 36),
    ('wood', 'Solid wood', 'خشب طبيعي', 37),
    ('mdf', 'MDF', 'خشب MDF', 38),
    ('bamboo', 'Bamboo', 'بامبو', 39),
    ('paper', 'Paper', 'ورق', 40),
    ('cardboard', 'Cardboard', 'كرتون', 41),
    ('stone', 'Stone', 'حجر', 42),
    ('marble', 'Marble', 'رخام', 43),
    ('granite', 'Granite', 'جرانيت', 44),
    ('foam', 'Foam', 'إسفنج', 45),
    ('mixed', 'Mixed materials', 'خامات مختلطة', 46),
    ('other', 'Other', 'أخرى', 47)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- main_material → materials
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'main_material' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('cotton', 'Cotton', 'قطن', 0),
    ('polyester', 'Polyester', 'بوليستر', 1),
    ('cotton_blend', 'Cotton blend', 'قطن مخلوط', 2),
    ('linen', 'Linen', 'كتان', 3),
    ('wool', 'Wool', 'صوف', 4),
    ('silk', 'Silk', 'حرير', 5),
    ('denim', 'Denim', 'جينز (دنيم)', 6),
    ('leather', 'Genuine leather', 'جلد طبيعي', 7),
    ('faux_leather', 'Faux leather', 'جلد صناعي', 8),
    ('suede', 'Suede', 'شامواه', 9),
    ('nylon', 'Nylon', 'نايلون', 10),
    ('elastane', 'Elastane / Spandex', 'إيلاستين / سباندكس', 11),
    ('viscose', 'Viscose / Rayon', 'فسكوز / رايون', 12),
    ('acrylic', 'Acrylic', 'أكريليك', 13),
    ('fleece', 'Fleece', 'فليس', 14),
    ('velvet', 'Velvet', 'قطيفة', 15),
    ('satin', 'Satin', 'ساتان', 16),
    ('chiffon', 'Chiffon', 'شيفون', 17),
    ('knit', 'Knit', 'تريكو', 18),
    ('canvas', 'Canvas', 'كانفاس', 19),
    ('rubber', 'Rubber', 'مطاط', 20),
    ('eva', 'EVA foam', 'إسفنج EVA', 21),
    ('plastic', 'Plastic', 'بلاستيك', 22),
    ('abs', 'ABS plastic', 'بلاستيك ABS', 23),
    ('silicone', 'Silicone', 'سيليكون', 24),
    ('metal', 'Metal', 'معدن', 25),
    ('stainless_steel', 'Stainless steel', 'ستانلس ستيل', 26),
    ('aluminum', 'Aluminum', 'ألومنيوم', 27),
    ('iron', 'Iron', 'حديد', 28),
    ('copper', 'Copper', 'نحاس', 29),
    ('brass', 'Brass', 'نحاس أصفر', 30),
    ('gold', 'Gold', 'ذهب', 31),
    ('silver', 'Silver', 'فضة', 32),
    ('glass', 'Glass', 'زجاج', 33),
    ('tempered_glass', 'Tempered glass', 'زجاج مقسّى', 34),
    ('ceramic', 'Ceramic', 'سيراميك', 35),
    ('porcelain', 'Porcelain', 'بورسلين', 36),
    ('wood', 'Solid wood', 'خشب طبيعي', 37),
    ('mdf', 'MDF', 'خشب MDF', 38),
    ('bamboo', 'Bamboo', 'بامبو', 39),
    ('paper', 'Paper', 'ورق', 40),
    ('cardboard', 'Cardboard', 'كرتون', 41),
    ('stone', 'Stone', 'حجر', 42),
    ('marble', 'Marble', 'رخام', 43),
    ('granite', 'Granite', 'جرانيت', 44),
    ('foam', 'Foam', 'إسفنج', 45),
    ('mixed', 'Mixed materials', 'خامات مختلطة', 46),
    ('other', 'Other', 'أخرى', 47)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- fabric_material → materials
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'fabric_material' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('cotton', 'Cotton', 'قطن', 0),
    ('polyester', 'Polyester', 'بوليستر', 1),
    ('cotton_blend', 'Cotton blend', 'قطن مخلوط', 2),
    ('linen', 'Linen', 'كتان', 3),
    ('wool', 'Wool', 'صوف', 4),
    ('silk', 'Silk', 'حرير', 5),
    ('denim', 'Denim', 'جينز (دنيم)', 6),
    ('leather', 'Genuine leather', 'جلد طبيعي', 7),
    ('faux_leather', 'Faux leather', 'جلد صناعي', 8),
    ('suede', 'Suede', 'شامواه', 9),
    ('nylon', 'Nylon', 'نايلون', 10),
    ('elastane', 'Elastane / Spandex', 'إيلاستين / سباندكس', 11),
    ('viscose', 'Viscose / Rayon', 'فسكوز / رايون', 12),
    ('acrylic', 'Acrylic', 'أكريليك', 13),
    ('fleece', 'Fleece', 'فليس', 14),
    ('velvet', 'Velvet', 'قطيفة', 15),
    ('satin', 'Satin', 'ساتان', 16),
    ('chiffon', 'Chiffon', 'شيفون', 17),
    ('knit', 'Knit', 'تريكو', 18),
    ('canvas', 'Canvas', 'كانفاس', 19),
    ('rubber', 'Rubber', 'مطاط', 20),
    ('eva', 'EVA foam', 'إسفنج EVA', 21),
    ('plastic', 'Plastic', 'بلاستيك', 22),
    ('abs', 'ABS plastic', 'بلاستيك ABS', 23),
    ('silicone', 'Silicone', 'سيليكون', 24),
    ('metal', 'Metal', 'معدن', 25),
    ('stainless_steel', 'Stainless steel', 'ستانلس ستيل', 26),
    ('aluminum', 'Aluminum', 'ألومنيوم', 27),
    ('iron', 'Iron', 'حديد', 28),
    ('copper', 'Copper', 'نحاس', 29),
    ('brass', 'Brass', 'نحاس أصفر', 30),
    ('gold', 'Gold', 'ذهب', 31),
    ('silver', 'Silver', 'فضة', 32),
    ('glass', 'Glass', 'زجاج', 33),
    ('tempered_glass', 'Tempered glass', 'زجاج مقسّى', 34),
    ('ceramic', 'Ceramic', 'سيراميك', 35),
    ('porcelain', 'Porcelain', 'بورسلين', 36),
    ('wood', 'Solid wood', 'خشب طبيعي', 37),
    ('mdf', 'MDF', 'خشب MDF', 38),
    ('bamboo', 'Bamboo', 'بامبو', 39),
    ('paper', 'Paper', 'ورق', 40),
    ('cardboard', 'Cardboard', 'كرتون', 41),
    ('stone', 'Stone', 'حجر', 42),
    ('marble', 'Marble', 'رخام', 43),
    ('granite', 'Granite', 'جرانيت', 44),
    ('foam', 'Foam', 'إسفنج', 45),
    ('mixed', 'Mixed materials', 'خامات مختلطة', 46),
    ('other', 'Other', 'أخرى', 47)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- body_material → materials
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'body_material' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or false where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('cotton', 'Cotton', 'قطن', 0),
    ('polyester', 'Polyester', 'بوليستر', 1),
    ('cotton_blend', 'Cotton blend', 'قطن مخلوط', 2),
    ('linen', 'Linen', 'كتان', 3),
    ('wool', 'Wool', 'صوف', 4),
    ('silk', 'Silk', 'حرير', 5),
    ('denim', 'Denim', 'جينز (دنيم)', 6),
    ('leather', 'Genuine leather', 'جلد طبيعي', 7),
    ('faux_leather', 'Faux leather', 'جلد صناعي', 8),
    ('suede', 'Suede', 'شامواه', 9),
    ('nylon', 'Nylon', 'نايلون', 10),
    ('elastane', 'Elastane / Spandex', 'إيلاستين / سباندكس', 11),
    ('viscose', 'Viscose / Rayon', 'فسكوز / رايون', 12),
    ('acrylic', 'Acrylic', 'أكريليك', 13),
    ('fleece', 'Fleece', 'فليس', 14),
    ('velvet', 'Velvet', 'قطيفة', 15),
    ('satin', 'Satin', 'ساتان', 16),
    ('chiffon', 'Chiffon', 'شيفون', 17),
    ('knit', 'Knit', 'تريكو', 18),
    ('canvas', 'Canvas', 'كانفاس', 19),
    ('rubber', 'Rubber', 'مطاط', 20),
    ('eva', 'EVA foam', 'إسفنج EVA', 21),
    ('plastic', 'Plastic', 'بلاستيك', 22),
    ('abs', 'ABS plastic', 'بلاستيك ABS', 23),
    ('silicone', 'Silicone', 'سيليكون', 24),
    ('metal', 'Metal', 'معدن', 25),
    ('stainless_steel', 'Stainless steel', 'ستانلس ستيل', 26),
    ('aluminum', 'Aluminum', 'ألومنيوم', 27),
    ('iron', 'Iron', 'حديد', 28),
    ('copper', 'Copper', 'نحاس', 29),
    ('brass', 'Brass', 'نحاس أصفر', 30),
    ('gold', 'Gold', 'ذهب', 31),
    ('silver', 'Silver', 'فضة', 32),
    ('glass', 'Glass', 'زجاج', 33),
    ('tempered_glass', 'Tempered glass', 'زجاج مقسّى', 34),
    ('ceramic', 'Ceramic', 'سيراميك', 35),
    ('porcelain', 'Porcelain', 'بورسلين', 36),
    ('wood', 'Solid wood', 'خشب طبيعي', 37),
    ('mdf', 'MDF', 'خشب MDF', 38),
    ('bamboo', 'Bamboo', 'بامبو', 39),
    ('paper', 'Paper', 'ورق', 40),
    ('cardboard', 'Cardboard', 'كرتون', 41),
    ('stone', 'Stone', 'حجر', 42),
    ('marble', 'Marble', 'رخام', 43),
    ('granite', 'Granite', 'جرانيت', 44),
    ('foam', 'Foam', 'إسفنج', 45),
    ('mixed', 'Mixed materials', 'خامات مختلطة', 46),
    ('other', 'Other', 'أخرى', 47)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- pattern → pattern
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'pattern' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('solid', 'Solid', 'سادة', 0),
    ('striped', 'Striped', 'مخطط', 1),
    ('checked', 'Checked / Plaid', 'كاروهات', 2),
    ('printed', 'Printed', 'مطبوع', 3),
    ('floral', 'Floral', 'ورود', 4),
    ('graphic', 'Graphic', 'رسومات', 5),
    ('polka_dot', 'Polka dot', 'منقط', 6),
    ('animal', 'Animal print', 'نقشة حيوانات', 7),
    ('camouflage', 'Camouflage', 'مموه', 8),
    ('geometric', 'Geometric', 'هندسي', 9),
    ('paisley', 'Paisley', 'بيزلي', 10),
    ('embroidered', 'Embroidered', 'مطرز', 11),
    ('tie_dye', 'Tie-dye', 'تاي داي', 12),
    ('color_block', 'Colour block', 'ألوان متداخلة', 13),
    ('other', 'Other', 'أخرى', 14)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- fit → fit
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'fit' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('regular', 'Regular', 'عادي', 0),
    ('slim', 'Slim', 'سليم', 1),
    ('skinny', 'Skinny', 'سكيني', 2),
    ('relaxed', 'Relaxed', 'مريح', 3),
    ('oversized', 'Oversized / Loose', 'واسع (أوفر سايز)', 4),
    ('straight', 'Straight', 'مستقيم', 5),
    ('tapered', 'Tapered', 'ضيق من الأسفل', 6),
    ('wide_leg', 'Wide leg', 'واسع الساق', 7),
    ('bootcut', 'Bootcut', 'بوت كات', 8),
    ('athletic', 'Athletic', 'رياضي', 9)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- occasion → occasion
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'occasion' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('casual', 'Casual', 'كاجوال', 0),
    ('formal', 'Formal', 'رسمي', 1),
    ('party', 'Party / Evening', 'حفلات / سهرة', 2),
    ('work', 'Work / Office', 'عمل / مكتب', 3),
    ('sports', 'Sports', 'رياضي', 4),
    ('wedding', 'Wedding', 'زفاف', 5),
    ('beach', 'Beach / Summer', 'شاطئ / صيفي', 6),
    ('home', 'Home / Lounge', 'منزلي', 7),
    ('travel', 'Travel', 'سفر', 8),
    ('religious', 'Ramadan & Eid', 'رمضان والأعياد', 9)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- age_group → age_group
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'age_group' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('newborn', 'Newborn (0–3 months)', 'حديث الولادة (0–3 شهور)', 0),
    ('infant', 'Infant (3–12 months)', 'رضيع (3–12 شهر)', 1),
    ('toddler', 'Toddler (1–3 years)', 'طفل صغير (1–3 سنوات)', 2),
    ('kids', 'Kids (3–8 years)', 'أطفال (3–8 سنوات)', 3),
    ('children', 'Children (8–12 years)', 'أطفال (8–12 سنة)', 4),
    ('teens', 'Teens (13–17 years)', 'مراهقون (13–17 سنة)', 5),
    ('adults', 'Adults', 'بالغون', 6),
    ('seniors', 'Seniors', 'كبار السن', 7),
    ('all_ages', 'All ages', 'كل الأعمار', 8)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- suitable_age_group → age_group
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'suitable_age_group' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('newborn', 'Newborn (0–3 months)', 'حديث الولادة (0–3 شهور)', 0),
    ('infant', 'Infant (3–12 months)', 'رضيع (3–12 شهر)', 1),
    ('toddler', 'Toddler (1–3 years)', 'طفل صغير (1–3 سنوات)', 2),
    ('kids', 'Kids (3–8 years)', 'أطفال (3–8 سنوات)', 3),
    ('children', 'Children (8–12 years)', 'أطفال (8–12 سنة)', 4),
    ('teens', 'Teens (13–17 years)', 'مراهقون (13–17 سنة)', 5),
    ('adults', 'Adults', 'بالغون', 6),
    ('seniors', 'Seniors', 'كبار السن', 7),
    ('all_ages', 'All ages', 'كل الأعمار', 8)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- declared_age_group → age_group
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'declared_age_group' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or false where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('newborn', 'Newborn (0–3 months)', 'حديث الولادة (0–3 شهور)', 0),
    ('infant', 'Infant (3–12 months)', 'رضيع (3–12 شهر)', 1),
    ('toddler', 'Toddler (1–3 years)', 'طفل صغير (1–3 سنوات)', 2),
    ('kids', 'Kids (3–8 years)', 'أطفال (3–8 سنوات)', 3),
    ('children', 'Children (8–12 years)', 'أطفال (8–12 سنة)', 4),
    ('teens', 'Teens (13–17 years)', 'مراهقون (13–17 سنة)', 5),
    ('adults', 'Adults', 'بالغون', 6),
    ('seniors', 'Seniors', 'كبار السن', 7),
    ('all_ages', 'All ages', 'كل الأعمار', 8)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- sizing_system → sizing_system
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'sizing_system' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or false where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('international', 'International (XS–XXL)', 'دولي (XS–XXL)', 0),
    ('eu', 'EU', 'أوروبي (EU)', 1),
    ('us', 'US', 'أمريكي (US)', 2),
    ('uk', 'UK', 'بريطاني (UK)', 3),
    ('egyptian', 'Egyptian', 'مصري', 4),
    ('asian', 'Asian', 'آسيوي', 5),
    ('one_size', 'One size', 'مقاس واحد', 6)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- sleeve_length → sleeve_length
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'sleeve_length' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('sleeveless', 'Sleeveless', 'بدون أكمام', 0),
    ('short', 'Short sleeve', 'كم قصير', 1),
    ('elbow', 'Elbow length', 'حتى الكوع', 2),
    ('three_quarter', '3/4 sleeve', 'كم 3/4', 3),
    ('long', 'Long sleeve', 'كم طويل', 4)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- closure_type → closure_type
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'closure_type' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('zipper', 'Zipper', 'سوستة', 0),
    ('buttons', 'Buttons', 'أزرار', 1),
    ('snap', 'Snap buttons', 'كباسين', 2),
    ('velcro', 'Hook & loop (Velcro)', 'فيلكرو (لاصق)', 3),
    ('lace_up', 'Lace-up', 'رباط', 4),
    ('slip_on', 'Slip-on', 'بدون رباط', 5),
    ('drawstring', 'Drawstring', 'رباط سحب', 6),
    ('elastic', 'Elastic', 'أستك', 7),
    ('buckle', 'Buckle', 'إبزيم', 8),
    ('magnetic', 'Magnetic', 'مغناطيسي', 9),
    ('none', 'None', 'بدون', 10)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- power_source → power_source
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'power_source' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('electric', 'Electric (mains)', 'كهرباء', 0),
    ('battery', 'Battery', 'بطارية', 1),
    ('rechargeable', 'Rechargeable battery', 'بطارية قابلة للشحن', 2),
    ('usb', 'USB', 'USB', 3),
    ('solar', 'Solar', 'طاقة شمسية', 4),
    ('manual', 'Manual', 'يدوي', 5),
    ('gas', 'Gas', 'غاز', 6),
    ('hybrid', 'Electric + battery', 'كهرباء + بطارية', 7)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- energy_rating → energy_rating
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'energy_rating' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('class_a3p', 'A+++', 'A+++', 0),
    ('class_a2p', 'A++', 'A++', 1),
    ('class_a1p', 'A+', 'A+', 2),
    ('class_a', 'A', 'A', 3),
    ('class_b', 'B', 'B', 4),
    ('class_c', 'C', 'C', 5),
    ('class_d', 'D', 'D', 6),
    ('class_e', 'E', 'E', 7)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- suitable_skin_type → suitable_skin_type
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'suitable_skin_type' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('all', 'All skin types', 'كل أنواع البشرة', 0),
    ('normal', 'Normal', 'عادية', 1),
    ('dry', 'Dry', 'جافة', 2),
    ('oily', 'Oily', 'دهنية', 3),
    ('combination', 'Combination', 'مختلطة', 4),
    ('sensitive', 'Sensitive', 'حساسة', 5),
    ('acne_prone', 'Acne-prone', 'معرّضة لحب الشباب', 6),
    ('mature', 'Mature', 'ناضجة', 7)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- product_form → product_form
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'product_form' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'enum', is_filterable = is_filterable or true where id = v_attr;
  insert into public.attribute_options (attribute_id, code, label_en, label_ar, sort)
  select v_attr, x.code, x.label_en, x.label_ar, x.sort from (values
    ('cream', 'Cream', 'كريم', 0),
    ('gel', 'Gel', 'جل', 1),
    ('liquid', 'Liquid', 'سائل', 2),
    ('lotion', 'Lotion', 'لوشن', 3),
    ('oil', 'Oil', 'زيت', 4),
    ('powder', 'Powder', 'بودرة', 5),
    ('spray', 'Spray', 'بخاخ', 6),
    ('serum', 'Serum', 'سيروم', 7),
    ('foam', 'Foam', 'رغوة', 8),
    ('stick', 'Stick', 'ستيك', 9),
    ('balm', 'Balm', 'بلسم', 10),
    ('tablet', 'Tablets', 'أقراص', 11),
    ('capsule', 'Capsules', 'كبسولات', 12),
    ('bar', 'Bar', 'قالب', 13),
    ('mask', 'Mask / Sheet', 'ماسك', 14),
    ('wipes', 'Wipes', 'مناديل', 15)
  ) as x(code, label_en, label_ar, sort)
  where not exists (select 1 from public.attribute_options o where o.attribute_id = v_attr and o.code = x.code and o.deleted_at is null);
  update public.product_attribute_values pav set option_id = o.id
  from public.attribute_options o
  where pav.attribute_id = v_attr and pav.option_id is null and pav.value_text is not null and o.attribute_id = v_attr
    and o.deleted_at is null
    and (lower(trim(pav.value_text)) = lower(o.label_en) or trim(pav.value_text) = o.label_ar);
end $$;

-- fragrance_free → yes/no
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'fragrance_free' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'bool' where id = v_attr;
  update public.product_attribute_values set
    value_bool = case when lower(trim(value_text)) in ('yes','true','نعم','1') then true
                      when lower(trim(value_text)) in ('no','false','لا','0') then false end
  where attribute_id = v_attr and value_bool is null and value_text is not null;
end $$;

-- dishwasher_safe → yes/no
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'dishwasher_safe' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'bool' where id = v_attr;
  update public.product_attribute_values set
    value_bool = case when lower(trim(value_text)) in ('yes','true','نعم','1') then true
                      when lower(trim(value_text)) in ('no','false','لا','0') then false end
  where attribute_id = v_attr and value_bool is null and value_text is not null;
end $$;

-- automatic_shut_off → yes/no
do $$
declare v_attr uuid;
begin
  select id into v_attr from public.attribute_defs where code = 'automatic_shut_off' and category_id is null and deleted_at is null limit 1;
  if v_attr is null then return; end if;
  update public.attribute_defs set type = 'bool' where id = v_attr;
  update public.product_attribute_values set
    value_bool = case when lower(trim(value_text)) in ('yes','true','نعم','1') then true
                      when lower(trim(value_text)) in ('no','false','لا','0') then false end
  where attribute_id = v_attr and value_bool is null and value_text is not null;
end $$;

commit;
