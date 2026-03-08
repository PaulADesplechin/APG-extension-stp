// BSP Country codes mapping for IATA BSP Link
const COUNTRY_MAPPING = {
  'AE': 'UNITED ARAB EMIRATES', 'AF': 'AFGHANISTAN', 'AL': 'ALBANIA',
  'AM': 'ARMENIA', 'AO': 'ANGOLA', 'AR': 'ARGENTINA', 'AT': 'AUSTRIA',
  'AU': 'AUSTRALIA', 'AZ': 'AZERBAIJAN', 'BA': 'BOSNIA AND HERZEGOVINA',
  'BD': 'BANGLADESH', 'BE': 'BELGIUM', 'BF': 'BURKINA FASO',
  'BG': 'BULGARIA', 'BH': 'BAHRAIN', 'BJ': 'BENIN', 'BO': 'BOLIVIA',
  'BR': 'BRAZIL', 'BS': 'BAHAMAS', 'BW': 'BOTSWANA', 'BY': 'BELARUS',
  'CA': 'CANADA', 'CD': 'CONGO DR', 'CF': 'CENTRAL AFRICAN REPUBLIC',
  'CG': 'CONGO', 'CH': 'SWITZERLAND', 'CI': 'IVORY COAST', 'CL': 'CHILE',
  'CM': 'CAMEROON', 'CN': 'CHINA', 'CO': 'COLOMBIA', 'CR': 'COSTA RICA',
  'CU': 'CUBA', 'CV': 'CAPE VERDE', 'CY': 'CYPRUS', 'CZ': 'CZECH REPUBLIC',
  'DE': 'GERMANY', 'DJ': 'DJIBOUTI', 'DK': 'DENMARK', 'DO': 'DOMINICAN REPUBLIC',
  'DZ': 'ALGERIA', 'EC': 'ECUADOR', 'EE': 'ESTONIA', 'EG': 'EGYPT',
  'ES': 'SPAIN', 'ET': 'ETHIOPIA', 'FI': 'FINLAND', 'FJ': 'FIJI',
  'FR': 'FRANCE', 'GA': 'GABON', 'GB': 'UNITED KINGDOM', 'GE': 'GEORGIA',
  'GH': 'GHANA', 'GM': 'GAMBIA', 'GN': 'GUINEA', 'GQ': 'EQUATORIAL GUINEA',
  'GR': 'GREECE', 'GT': 'GUATEMALA', 'GY': 'GUYANA', 'HK': 'HONG KONG',
  'HN': 'HONDURAS', 'HR': 'CROATIA', 'HT': 'HAITI', 'HU': 'HUNGARY',
  'ID': 'INDONESIA', 'IE': 'IRELAND', 'IL': 'ISRAEL', 'IN': 'INDIA',
  'IQ': 'IRAQ', 'IR': 'IRAN', 'IS': 'ICELAND', 'IT': 'ITALY',
  'JM': 'JAMAICA', 'JO': 'JORDAN', 'JP': 'JAPAN', 'KE': 'KENYA',
  'KG': 'KYRGYZSTAN', 'KH': 'CAMBODIA', 'KR': 'SOUTH KOREA', 'KW': 'KUWAIT',
  'KZ': 'KAZAKHSTAN', 'LA': 'LAOS', 'LB': 'LEBANON', 'LK': 'SRI LANKA',
  'LR': 'LIBERIA', 'LT': 'LITHUANIA', 'LU': 'LUXEMBOURG', 'LV': 'LATVIA',
  'LY': 'LIBYA', 'MA': 'MOROCCO', 'MD': 'MOLDOVA', 'MG': 'MADAGASCAR',
  'MK': 'NORTH MACEDONIA', 'ML': 'MALI', 'MM': 'MYANMAR', 'MN': 'MONGOLIA',
  'MR': 'MAURITANIA', 'MT': 'MALTA', 'MU': 'MAURITIUS', 'MV': 'MALDIVES',
  'MW': 'MALAWI', 'MX': 'MEXICO', 'MY': 'MALAYSIA', 'MZ': 'MOZAMBIQUE',
  'NA': 'NAMIBIA', 'NE': 'NIGER', 'NG': 'NIGERIA', 'NI': 'NICARAGUA',
  'NL': 'NETHERLANDS', 'NO': 'NORWAY', 'NP': 'NEPAL', 'NZ': 'NEW ZEALAND',
  'OM': 'OMAN', 'PA': 'PANAMA', 'PE': 'PERU', 'PF': 'FRENCH POLYNESIA',
  'PG': 'PAPUA NEW GUINEA', 'PH': 'PHILIPPINES', 'PK': 'PAKISTAN',
  'PL': 'POLAND', 'PR': 'PUERTO RICO', 'PT': 'PORTUGAL', 'PY': 'PARAGUAY',
  'QA': 'QATAR', 'RO': 'ROMANIA', 'RS': 'SERBIA', 'RU': 'RUSSIA',
  'RW': 'RWANDA', 'SA': 'SAUDI ARABIA', 'SC': 'SEYCHELLES', 'SD': 'SUDAN',
  'SE': 'SWEDEN', 'SG': 'SINGAPORE', 'SI': 'SLOVENIA', 'SK': 'SLOVAKIA',
  'SL': 'SIERRA LEONE', 'SN': 'SENEGAL', 'SO': 'SOMALIA', 'SR': 'SURINAME',
  'SV': 'EL SALVADOR', 'SY': 'SYRIA', 'TG': 'TOGO', 'TH': 'THAILAND',
  'TJ': 'TAJIKISTAN', 'TM': 'TURKMENISTAN', 'TN': 'TUNISIA', 'TR': 'TURKEY',
  'TT': 'TRINIDAD AND TOBAGO', 'TW': 'TAIWAN', 'TZ': 'TANZANIA',
  'UA': 'UKRAINE', 'UG': 'UGANDA', 'US': 'UNITED STATES', 'UY': 'URUGUAY',
  'UZ': 'UZBEKISTAN', 'VE': 'VENEZUELA', 'VN': 'VIETNAM', 'YE': 'YEMEN',
  'ZA': 'SOUTH AFRICA', 'ZM': 'ZAMBIA', 'ZW': 'ZIMBABWE'
};

function getCountryName(code) {
  return COUNTRY_MAPPING[code?.toUpperCase()] || code;
}

function getCountryCode(name) {
  const upper = name?.toUpperCase();
  for (const [code, cname] of Object.entries(COUNTRY_MAPPING)) {
    if (cname === upper) return code;
  }
  return null;
}

function getAllCountries() {
  return Object.entries(COUNTRY_MAPPING).map(([code, name]) => ({ code, name }));
}
