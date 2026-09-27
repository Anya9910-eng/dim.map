import { useState } from "react";

export type Lang = "en" | "ru";

const LS_KEY = "tgapp-lang";

export const translations = {
  en: {
    pending: "Pending",
    sentHistory: "Sent history",
    loadingDrafts: "Loading drafts…",
    allClear: "All clear",
    noPendingDrafts: "No pending drafts right now",
    noHistory: "No sent drafts yet",
    hiUser: "Hi,",
    send: "Send",
    edit: "Edit",
    discard: "Discard",
    sendEdited: "Send edited",
    cancel: "Cancel",
    stopRecording: "Stop recording",
    dictateEdit: "Dictate edit",
    listening: "Listening… tap ⏹ to stop",
    sentToday: "sent today",
    totalSent: "total sent",
    successRate: "success rate",
    replySent: "Reply sent",
    editedSent: "Edited & sent",
    discarded: "Discarded",
  },
  ru: {
    pending: "Ожидают",
    sentHistory: "История",
    loadingDrafts: "Загрузка…",
    allClear: "Всё чисто",
    noPendingDrafts: "Нет ожидающих черновиков",
    noHistory: "Нет отправленных черновиков",
    hiUser: "Привет,",
    send: "Отправить",
    edit: "Изменить",
    discard: "Отклонить",
    sendEdited: "Отправить правку",
    cancel: "Отмена",
    stopRecording: "Остановить запись",
    dictateEdit: "Диктовать правку",
    listening: "Слушаю… нажмите ⏹ чтобы остановить",
    sentToday: "отправлено сегодня",
    totalSent: "отправлено всего",
    successRate: "успешность",
    replySent: "Ответ отправлен",
    editedSent: "Правка отправлена",
    discarded: "Отклонено",
  },
} as const;

export function useLang() {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved === "en" || saved === "ru") return saved;
    } catch {}
    return "en";
  });

  function setLang(l: Lang) {
    setLangState(l);
    try { localStorage.setItem(LS_KEY, l); } catch {}
  }

  return { lang, setLang, tr: translations[lang] };
}
