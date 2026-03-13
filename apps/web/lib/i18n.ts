export type AppLanguage = 'ru' | 'kk';

export type TranslationKey =
  | 'loading'
  | 'logout'
  | 'userFallback'
  | 'home'
  | 'yourSessions'
  | 'manageSessions'
  | 'currentPlan'
  | 'planFree'
  | 'planCoach'
  | 'planPro'
  | 'planLimitsFree'
  | 'planLimitsCoach'
  | 'planLimitsPro'
  | 'createNewSession'
  | 'continueLastSession'
  | 'loadingSessions'
  | 'noSessions'
  | 'createFirstSession'
  | 'activeSessions'
  | 'pastSessions'
  | 'openSession'
  | 'createdAt'
  | 'open'
  | 'delete'
  | 'deleteConfirm'
  | 'modalCreateTitle'
  | 'modalFillAllFields'
  | 'modalInvalidYoutube'
  | 'modalCreateFailed'
  | 'modalSessionName'
  | 'modalSessionNamePlaceholder'
  | 'modalYoutubeUrl'
  | 'modalYoutubeHint'
  | 'cancel'
  | 'creating'
  | 'modalQuickTipTitle'
  | 'modalQuickTipText'
  | 'language';

const translations: Record<AppLanguage, Record<TranslationKey, string>> = {
  ru: {
    loading: 'Загрузка...',
    logout: 'Выйти',
    userFallback: 'Пользователь',
    home: 'На главную',
    yourSessions: 'Ваши сессии',
    manageSessions: 'Управляйте сессиями тактического анализа',
    currentPlan: 'Текущий план',
    planFree: 'FREE',
    planCoach: 'COACH',
    planPro: 'PRO',
    planLimitsFree: 'Лимит: 1 сессия, 2 участника, 3 минуты',
    planLimitsCoach: 'Безлимит по времени, 4 участника',
    planLimitsPro: 'Безлимит по времени, 6 участников, 4 комнаты',
    createNewSession: 'Создать новую сессию',
    continueLastSession: 'Продолжить последнюю сессию',
    loadingSessions: 'Загрузка сессий...',
    noSessions: 'Сессий пока нет',
    createFirstSession: 'Создать первую сессию',
    activeSessions: 'Активные сессии',
    pastSessions: 'Прошлые сессии',
    openSession: 'Открыть сессию',
    createdAt: 'Создано',
    open: 'Открыть',
    delete: 'Удалить',
    deleteConfirm: 'Вы уверены, что хотите удалить эту сессию?',
    modalCreateTitle: 'Создать новую сессию',
    modalFillAllFields: 'Заполните все поля',
    modalInvalidYoutube: 'Введите корректную ссылку YouTube',
    modalCreateFailed: 'Не удалось создать сессию',
    modalSessionName: 'Название сессии',
    modalSessionNamePlaceholder: 'Например: Тактический разбор Ман Сити vs Арсенал',
    modalYoutubeUrl: 'Ссылка YouTube',
    modalYoutubeHint: 'Вставьте любую ссылку на YouTube. ID видео определится автоматически.',
    cancel: 'Отмена',
    creating: 'Создание...',
    modalQuickTipTitle: 'Быстрый совет',
    modalQuickTipText: 'Используйте любое публичное видео YouTube. После создания поделитесь QR-кодом с командой.',
    language: 'Язык',
  },
  kk: {
    loading: 'Жүктелуде...',
    logout: 'Шығу',
    userFallback: 'Пайдаланушы',
    home: 'Басты бет',
    yourSessions: 'Сессияларыңыз',
    manageSessions: 'Тактикалық талдау сессияларын басқарыңыз',
    currentPlan: 'Ағымдағы жоспар',
    planFree: 'FREE',
    planCoach: 'COACH',
    planPro: 'PRO',
    planLimitsFree: 'Шектеу: 1 сессия, 2 қатысушы, 3 минут',
    planLimitsCoach: 'Уақыт шексіз, 4 қатысушы',
    planLimitsPro: 'Уақыт шексіз, 6 қатысушы, 4 бөлме',
    createNewSession: 'Жаңа сессия құру',
    continueLastSession: 'Соңғы сессияны жалғастыру',
    loadingSessions: 'Сессиялар жүктелуде...',
    noSessions: 'Әзірге сессия жоқ',
    createFirstSession: 'Алғашқы сессияны құру',
    activeSessions: 'Белсенді сессиялар',
    pastSessions: 'Өткен сессиялар',
    openSession: 'Сессияны ашу',
    createdAt: 'Құрылған күні',
    open: 'Ашу',
    delete: 'Жою',
    deleteConfirm: 'Бұл сессияны жоюға сенімдісіз бе?',
    modalCreateTitle: 'Жаңа сессия құру',
    modalFillAllFields: 'Барлық өрістерді толтырыңыз',
    modalInvalidYoutube: 'YouTube сілтемесін дұрыс енгізіңіз',
    modalCreateFailed: 'Сессия құру сәтсіз аяқталды',
    modalSessionName: 'Сессия атауы',
    modalSessionNamePlaceholder: 'Мысалы: Ман Сити vs Арсенал тактикалық талдауы',
    modalYoutubeUrl: 'YouTube сілтемесі',
    modalYoutubeHint: 'Кез келген YouTube сілтемесін қойыңыз. Видео ID автоматты түрде алынады.',
    cancel: 'Бас тарту',
    creating: 'Құрылуда...',
    modalQuickTipTitle: 'Жылдам кеңес',
    modalQuickTipText: 'Кез келген ашық YouTube видеосын қолдана аласыз. Құрғаннан кейін QR-кодты командамен бөлісіңіз.',
    language: 'Тіл',
  },
};

export function t(language: AppLanguage, key: TranslationKey): string {
  return translations[language][key] || translations.ru[key];
}
