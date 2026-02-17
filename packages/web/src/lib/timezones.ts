/**
 * Comprehensive list of IANA timezone codes for use in User and Server settings
 * Organized by region for easier navigation
 */

export interface TimezoneOption {
    value: string;
    label: string;
}

export const TIMEZONES: TimezoneOption[] = [
    // UTC
    { value: 'UTC', label: 'UTC - Coordinated Universal Time' },

    // North America - US
    { value: 'America/New_York', label: 'America/New_York - Eastern Time' },
    { value: 'America/Chicago', label: 'America/Chicago - Central Time' },
    { value: 'America/Denver', label: 'America/Denver - Mountain Time' },
    { value: 'America/Phoenix', label: 'America/Phoenix - Arizona (no DST)' },
    { value: 'America/Los_Angeles', label: 'America/Los_Angeles - Pacific Time' },
    { value: 'America/Anchorage', label: 'America/Anchorage - Alaska Time' },
    { value: 'Pacific/Honolulu', label: 'Pacific/Honolulu - Hawaii Time' },

    // North America - Canada
    { value: 'America/St_Johns', label: 'America/St_Johns - Newfoundland Time' },
    { value: 'America/Halifax', label: 'America/Halifax - Atlantic Time' },
    { value: 'America/Toronto', label: 'America/Toronto - Eastern Time' },
    { value: 'America/Winnipeg', label: 'America/Winnipeg - Central Time' },
    { value: 'America/Edmonton', label: 'America/Edmonton - Mountain Time' },
    { value: 'America/Vancouver', label: 'America/Vancouver - Pacific Time' },

    // Atlantic
    { value: 'Atlantic/Bermuda', label: 'Atlantic/Bermuda - Atlantic Time' },
    { value: 'Atlantic/Azores', label: 'Atlantic/Azores - Azores Time' },
    { value: 'Atlantic/Cape_Verde', label: 'Atlantic/Cape_Verde - Cape Verde Time' },
    { value: 'Atlantic/Reykjavik', label: 'Atlantic/Reykjavik - Iceland' },

    // Central & South America
    { value: 'America/Mexico_City', label: 'America/Mexico_City - Central Mexico' },
    { value: 'America/Guatemala', label: 'America/Guatemala - Guatemala' },
    { value: 'America/Costa_Rica', label: 'America/Costa_Rica - Costa Rica' },
    { value: 'America/Panama', label: 'America/Panama - Panama' },
    { value: 'America/Bogota', label: 'America/Bogota - Colombia' },
    { value: 'America/Lima', label: 'America/Lima - Peru' },
    { value: 'America/Santiago', label: 'America/Santiago - Chile' },
    { value: 'America/Caracas', label: 'America/Caracas - Venezuela' },
    { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo - Brazil (São Paulo)' },
    { value: 'America/Argentina/Buenos_Aires', label: 'America/Argentina/Buenos_Aires - Argentina' },

    // Europe - Western
    { value: 'Europe/London', label: 'Europe/London - UK, Ireland, Portugal' },
    { value: 'Europe/Dublin', label: 'Europe/Dublin - Ireland' },
    { value: 'Europe/Lisbon', label: 'Europe/Lisbon - Portugal' },

    // Europe - Central
    { value: 'Europe/Paris', label: 'Europe/Paris - France' },
    { value: 'Europe/Berlin', label: 'Europe/Berlin - Germany' },
    { value: 'Europe/Madrid', label: 'Europe/Madrid - Spain' },
    { value: 'Europe/Rome', label: 'Europe/Rome - Italy' },
    { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam - Netherlands' },
    { value: 'Europe/Brussels', label: 'Europe/Brussels - Belgium' },
    { value: 'Europe/Vienna', label: 'Europe/Vienna - Austria' },
    { value: 'Europe/Warsaw', label: 'Europe/Warsaw - Poland' },
    { value: 'Europe/Prague', label: 'Europe/Prague - Czech Republic' },
    { value: 'Europe/Stockholm', label: 'Europe/Stockholm - Sweden' },
    { value: 'Europe/Oslo', label: 'Europe/Oslo - Norway' },
    { value: 'Europe/Copenhagen', label: 'Europe/Copenhagen - Denmark' },
    { value: 'Europe/Zurich', label: 'Europe/Zurich - Switzerland' },

    // Europe - Eastern
    { value: 'Europe/Athens', label: 'Europe/Athens - Greece' },
    { value: 'Europe/Bucharest', label: 'Europe/Bucharest - Romania' },
    { value: 'Europe/Helsinki', label: 'Europe/Helsinki - Finland' },
    { value: 'Europe/Istanbul', label: 'Europe/Istanbul - Turkey' },
    { value: 'Europe/Kiev', label: 'Europe/Kiev - Ukraine' },
    { value: 'Europe/Moscow', label: 'Europe/Moscow - Russia (Moscow)' },

    // Middle East & Africa
    { value: 'Africa/Cairo', label: 'Africa/Cairo - Egypt' },
    { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg - South Africa' },
    { value: 'Africa/Nairobi', label: 'Africa/Nairobi - Kenya' },
    { value: 'Africa/Lagos', label: 'Africa/Lagos - Nigeria' },
    { value: 'Asia/Dubai', label: 'Asia/Dubai - UAE' },
    { value: 'Asia/Jerusalem', label: 'Asia/Jerusalem - Israel' },
    { value: 'Asia/Riyadh', label: 'Asia/Riyadh - Saudi Arabia' },
    { value: 'Asia/Tehran', label: 'Asia/Tehran - Iran' },

    // Asia - South & Central
    { value: 'Asia/Karachi', label: 'Asia/Karachi - Pakistan' },
    { value: 'Asia/Kolkata', label: 'Asia/Kolkata - India' },
    { value: 'Asia/Kathmandu', label: 'Asia/Kathmandu - Nepal' },
    { value: 'Asia/Dhaka', label: 'Asia/Dhaka - Bangladesh' },
    { value: 'Asia/Colombo', label: 'Asia/Colombo - Sri Lanka' },

    // Asia - Southeast
    { value: 'Asia/Bangkok', label: 'Asia/Bangkok - Thailand' },
    { value: 'Asia/Singapore', label: 'Asia/Singapore - Singapore' },
    { value: 'Asia/Jakarta', label: 'Asia/Jakarta - Indonesia (Jakarta)' },
    { value: 'Asia/Manila', label: 'Asia/Manila - Philippines' },
    { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh - Vietnam' },

    // Asia - East
    { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong - Hong Kong' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai - China' },
    { value: 'Asia/Taipei', label: 'Asia/Taipei - Taiwan' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo - Japan' },
    { value: 'Asia/Seoul', label: 'Asia/Seoul - South Korea' },

    // Pacific - Australia & New Zealand
    { value: 'Australia/Perth', label: 'Australia/Perth - Western Australia' },
    { value: 'Australia/Adelaide', label: 'Australia/Adelaide - South Australia' },
    { value: 'Australia/Darwin', label: 'Australia/Darwin - Northern Territory' },
    { value: 'Australia/Brisbane', label: 'Australia/Brisbane - Queensland' },
    { value: 'Australia/Sydney', label: 'Australia/Sydney - New South Wales' },
    { value: 'Australia/Melbourne', label: 'Australia/Melbourne - Victoria' },
    { value: 'Australia/Hobart', label: 'Australia/Hobart - Tasmania' },
    { value: 'Pacific/Auckland', label: 'Pacific/Auckland - New Zealand' },

    // Pacific Islands
    { value: 'Pacific/Fiji', label: 'Pacific/Fiji - Fiji' },
    { value: 'Pacific/Guam', label: 'Pacific/Guam - Guam' },
    { value: 'Pacific/Tahiti', label: 'Pacific/Tahiti - Tahiti' },
];

/**
 * User timezone options include an option to hide timezone
 */
export const USER_TIMEZONES: TimezoneOption[] = [
    { value: '', label: 'Hidden - Do not display timezone' },
    ...TIMEZONES,
];

/**
 * Server timezone options (must have a timezone set)
 */
export const SERVER_TIMEZONES: TimezoneOption[] = TIMEZONES;
