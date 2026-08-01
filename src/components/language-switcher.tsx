"use client";

import { Check } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/provider";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@/i18n/locales";
import { cn } from "@/lib/utils";

export const LanguageSwitcher = ({ className }: { className?: string }) => {
  const { locale, setLocale, t } = useI18n();
  const currentLanguageId = useId();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-11 shrink-0 text-xs font-semibold tracking-wide",
            className,
          )}
          aria-label={t("language.menuLabel")}
          aria-describedby={currentLanguageId}
        >
          <span aria-hidden="true">{locale.toUpperCase()}</span>
          <span id={currentLanguageId} className="sr-only">
            {t("language.current", { language: LOCALE_NAMES[locale] })}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48"
        aria-label={t("language.menuLabel")}
      >
        {SUPPORTED_LOCALES.map((option) => {
          const current = option === locale;
          return (
            <DropdownMenuItem
              key={option}
              className="min-h-11 justify-between"
              aria-current={current ? "true" : undefined}
              onSelect={() => setLocale(option)}
            >
              <span lang={option}>{LOCALE_NAMES[option]}</span>
              <Check
                className={cn("size-4", !current && "invisible")}
                aria-hidden="true"
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
