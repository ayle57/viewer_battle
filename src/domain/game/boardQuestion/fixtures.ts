import type { BoardQuestionConfig } from "./types";

/**
 * FIXTURE DATA — not real show content. Small on purpose (3 categories x
 * 2 questions = 6) so a full game in tests/the /dev/game playground plays
 * out in a handful of actions instead of a full 5x5 board. Used by
 * engine.test.ts and /dev/game; real category/question content is a
 * future content-authoring concern, not a Game Kernel one.
 */
export const sampleBoard: BoardQuestionConfig = {
  categories: [
    { id: "cat-geo", name: "Geography" },
    { id: "cat-sci", name: "Science" },
    { id: "cat-film", name: "Film" },
  ],
  questions: [
    { id: "q-geo-100", categoryId: "cat-geo", points: 100, prompt: "The longest river in the world.", answer: "The Nile" },
    { id: "q-geo-200", categoryId: "cat-geo", points: 200, prompt: "The smallest country in the world.", answer: "Vatican City" },
    { id: "q-sci-100", categoryId: "cat-sci", points: 100, prompt: "The chemical symbol for gold.", answer: "Au" },
    { id: "q-sci-200", categoryId: "cat-sci", points: 200, prompt: "The powerhouse of the cell.", answer: "The mitochondria" },
    { id: "q-film-100", categoryId: "cat-film", points: 100, prompt: "Director of Jaws and E.T.", answer: "Steven Spielberg" },
    { id: "q-film-200", categoryId: "cat-film", points: 200, prompt: "The 1994 film about a wrongly imprisoned banker.", answer: "The Shawshank Redemption" },
  ],
};
