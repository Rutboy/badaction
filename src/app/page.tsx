import { CreateBoardButton } from "@/components/create-board-button";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl items-center px-5 py-12 sm:px-8">
      <section aria-labelledby="home-title" className="w-full">
        <p className="mb-10 text-sm font-semibold tracking-tight text-primary">badaction</p>
        <div className="max-w-2xl">
          <h1
            id="home-title"
            className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-5xl"
          >
            Простая ретроспектива для вашей команды
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Соберите обратную связь, проголосуйте за важное и зафиксируйте решения на одной доске.
          </p>
        </div>

        <div className="mt-9 max-w-lg">
          <CreateBoardButton />
          <p className="mt-4 text-sm leading-5 text-muted-foreground">
            Без регистрации. Данные хранятся ограниченное время.
          </p>
        </div>
      </section>
    </main>
  );
}
