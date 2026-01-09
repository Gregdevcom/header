import dotenv from "dotenv";
import mongoose from "mongoose";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import puppeteer from "puppeteer";
import { ArticleEN, ArticleNL, ArchiveEN, ArchiveNL } from "./mainSchemas.js";
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import cron from "node-cron";
import TextStatistics from "text-statistics";
import { translate } from "google-translate-api-x";

dotenv.config();

const API_KEYS = {
  EN: process.env.NEWS_RESULTS_KEY_EN, // from https://newsdata.io/search-dashboard
  NL: process.env.NEWS_RESULTS_KEY_NL,
};

const Articles = {
  EN: ArticleEN,
  NL: ArticleNL,
};

const Archives = { EN: ArchiveEN, NL: ArchiveNL };

const AI_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: AI_KEY });

await connectDB();

async function connectDB() {
  try {
    await mongoose.connect("mongodb://localhost:27017/news_scraper");
    console.log("Database connected!\n");
  } catch (e) {
    console.error(e);
  }
}

async function archiveDailyNews(lang) {
  // Ids may repeat in Archive and in Article collections
  console.log(`Archive process started (${lang})`);
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const currentArticles = await Articles[lang].find({}).session(session);
    if (currentArticles.length > 0) {
      await Archives[lang].insertMany(currentArticles, { session });
      await Articles[lang].deleteMany({}, { session });
      await session.commitTransaction();
    } else {
      throw new Error();
    }
  } catch {
    console.log(
      "Archiving unsuccessful: Article collection is empty (no changes made)"
    );
    await session.abortTransaction();
  } finally {
    session.endSession();
  }
}

async function getLatestArticles(lang, pageNum) {
  if (!process.env[`NEWS_RESULTS_KEY_${lang}`] || !process.env.OPENAI_API_KEY) {
    throw new Error("Missing required API keys");
  }
  let fullUrl = "";
  if (!pageNum) {
    if (lang === "NL") {
      fullUrl = `https://newsdata.io/api/1/latest?apikey=${API_KEYS[lang]}&country=nl&language=nl,en&excludecategory=sports&prioritydomain=top&removeduplicate=1`;
    } else {
      fullUrl = `https://newsdata.io/api/1/latest?apikey=${API_KEYS[lang]}&language=en&excludecategory=sports&prioritydomain=top&removeduplicate=1`;
    }
  } else {
    if (lang === "NL") {
      fullUrl =
        `https://newsdata.io/api/1/latest?apikey=${API_KEYS[lang]}&country=nl&language=nl,en&excludecategory=sports&prioritydomain=top&removeduplicate=1` +
        `&page=${pageNum}`;
    } else {
      fullUrl =
        `https://newsdata.io/api/1/latest?apikey=${API_KEYS[lang]}&language=en&excludecategory=sports&prioritydomain=top&removeduplicate=1` +
        `&page=${pageNum}`;
    }
  }

  try {
    const response = await fetch(fullUrl);
    if (!response.ok) {
      throw new Error(`HTTP error (code not ok): ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== "success") {
      throw new Error("API request failed");
    }

    const articleData = data.results.map((article) => ({
      link: article.link,
      imageLink: article.image_url,
      date: article.pubDate,
      author: article.creator,
    }));
    const validArticles = articleData.filter(
      (article) => article.link && article.link.trim() !== ""
    );

    if (validArticles.length > 0) {
      return {
        pageNum: data.nextPage,
        articles: validArticles,
      };
    } else {
      throw new Error("No valid links found in this batch");
    }
  } catch (error) {
    console.error(
      `Error fetching news data from API's response: ${error.message}\n`
    );
    return null;
  }
}

async function extractText(lang) {
  let failure = false;
  let browser;
  let pageNum = null;
  let successfulArticles = 0;
  let page;
  try {
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 60000,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--no-sandbox",
        "--lang=en-US,en",
        "--disable-setuid-sandbox",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1920,1080",
      ],
    });

    const ts = new TextStatistics();

    while (true) {
      if (successfulArticles >= 20) {
        console.log("All articles processed");
        break;
      }
      const result = await getLatestArticles(lang, pageNum);
      if (!result) {
        console.error("Api Failure, execution stopped");
        return;
      }

      if (failure) {
        console.log("No summary from OpenAI");
        return;
      }

      const currentBatch = result.articles;
      pageNum = result.pageNum;

      for (const currentArticle of currentBatch) {
        const linkReturned = currentArticle.link;
        const imageLinkReturned = currentArticle.imageLink;
        const author = currentArticle.author?.[0] || null;
        const finalDate = currentArticle.date ? currentArticle.date : null;
        const skipWords = [
          "/video/",
          "/watch/",
          "/gallery/",
          "/photos/",
          "/series/",
        ];

        if (failure) {
          break;
        }
        if (skipWords.some((keyword) => linkReturned.includes(keyword))) {
          continue;
        }

        const isInArticle = await Articles[lang].exists({
          link: linkReturned,
        });
        const isInArchive = await Archives[lang].exists({
          link: linkReturned,
        });

        if (isInArticle || isInArchive) {
          continue;
        }

        console.log(`\nArticle: ${linkReturned}\n`);

        try {
          page = null;
          page = await browser.newPage();
          await page.setViewport({ width: 1920, height: 1080 });
          await page.setRequestInterception(true);

          page.on("request", (request) => {
            if (request.resourceType() === "document") {
              request.continue();
              return;
            }
            const blockedDomains = [
              "google-analytics.com",
              "googletagmanager.com",
              "doubleclick.net",
              "facebook.com",
              "facebook.net",
              "connect.facebook.net",
              "analytics",
              "ads",
              "tracking",
            ];

            const url = request.url();
            const shouldBlock = blockedDomains.some((domain) =>
              url.includes(domain)
            );
            if (shouldBlock || request.resourceType() === "stylesheet") {
              request.abort();
            } else {
              request.continue();
            }
          });

          await page.setExtraHTTPHeaders({
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language":
              lang === "NL" ? "nl-NL,nl;q=0.9" : "en-US,en;q=0.9",
          });
          await page.goto(linkReturned, {
            waitUntil: "domcontentloaded",
            timeout: 50000,
          });

          if (page.url().includes("news.google.com")) {
            try {
              const googleConsentSelectors = [
                "//button[contains(., 'I agree')]",
                "//button[contains(., 'Accept All')]",
                "//button[contains(., 'Accept all')]",
                "//button[contains(., 'Continue')]",
                "//button[contains(., 'I agree')]",
                "//button[contains(., 'I Agree')]",
                "//a[contains(@href, './articles/')]",
              ];
              for (const but of googleConsentSelectors) {
                const [btn] = await page.$$(`xpath/${but}`);
                if (btn) {
                  await btn.click();
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }
              }
              await page.waitForFunction(
                () => !window.location.href.includes("news.google.com")
              );
              await new Promise((resolve) => setTimeout(resolve, 1000));
              if (page.url().includes("news.google.com")) {
                continue;
              }
            } catch (e) {
              if (!e.message.includes("Execution context was destroyed")) {
                console.error(`Google News Redirect error: ${e}`);
              }
            }
          }

          try {
            const buttons = await page.$$(
              "xpath///button[contains(., 'Accept') or contains(., 'I agree') or contains(., 'Agree') or contains(., 'Consent') or contains(., 'Accept All') or contains(., 'Agree to All') or contains(., 'Agree To All') or contains(., 'I consent') or contains(., 'I Consent') or contains(., 'Got it') or contains(., 'Got It') or contains(., 'Akkoord') or contains(., 'Ja')]"
            );

            for (const btn of buttons) {
              const clicked = await page.evaluate((el) => {
                // page.evaluate() takes 2 parameters - 1. The function, 2. Data to feed as 1st parameter into the function
                const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;

                if (isVisible) {
                  el.click();
                  return true;
                }
                return false;
              }, btn);

              if (clicked) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                break;
              }
            }
          } catch (e) {
            console.error(`Consent button error: ${e}`);
          }

          const finalUrl = page.url();

          const bannedParts = [
            "consent.google.com",
            "cookie",
            "cookielaw.org",
            "onetrust.com",
            "consentmanager",
          ];

          if (bannedParts.some((part) => finalUrl.includes(part))) {
            await page.close().catch(() => {});
            page = null;
            continue;
          }

          try {
            await autoScroll(page);
          } catch (e) {
            console.log("Auto-scrolling interrupted, continuing anyways", "\n");
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));

          const html = await page.content();

          await page.close().catch(() => {});

          page = null;

          const virtualConsole = new VirtualConsole();
          virtualConsole.on("error", () => {});

          const styleFreeHtml = html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/ style="[^"]*"/gi, "");

          const dom = new JSDOM(styleFreeHtml, {
            url: finalUrl,
            virtualConsole,
          });

          const doc = dom.window.document;
          const junkSelectors = [
            "script",
            "style",
            "nav",
            "footer",
            "header",
            "noscript",
            "iframe",
            ".ad",
            ".advertisement",
            "#cookie-banner",
          ];

          junkSelectors.forEach((selector) => {
            const elements = doc.querySelectorAll(selector);
            elements.forEach((el) => el.remove());
          });

          const reader = new Readability(doc);
          const article = reader.parse();
          if (!article || !article.textContent) {
            continue;
          }

          const badTitles = [
            "privacy policy",
            "terms of service",
            "terms and conditions",
            "403 forbidden",
            "page not found",
            "access denied",
            "just a moment...",
            "attention required!",
            "robot or human?",
            "security challenge",
            "captcha",
            "cookie",
            "cookies",
          ];

          if (
            article.title &&
            badTitles.some((t) => article.title.toLowerCase().includes(t))
          ) {
            continue;
          }
          let cleanedText = article.textContent.replace(/\s+/g, " ").trim();
          const count = ts.wordCount(cleanedText);

          const garbagePhrases = [
            "video Player is loading",
            "please use chrome browser",
            "unsupported location",
            "error code: access_denied",
            "stream type live",
            "our cookie policy",
            "javascript is disabled",
            "turn off your ad blocker",
            "strictly necessary cookies",
            "performance cookies",
            "manage your preferences",
            "manage consent",
            "ad partners",
            "consent to the use of cookies",
            "to continue reading this article",
            "log in or subscribe",
            "create an account to read",
            "you have reached your limit",
            "this content is only available to subscribers",
            "tcf vendors",
            "to continue reading, please subscribe for full access",
            "premium subscribers",
          ];

          if (
            garbagePhrases.some((garbage) =>
              cleanedText.toLowerCase().includes(garbage)
            )
          ) {
            continue;
          }

          const minWordCount = 200;
          const maxWordCount = 1500;
          let isContentCut = false;

          if (cleanedText) {
            if (count > minWordCount) {
              try {
                if (count > maxWordCount) {
                  // find the 1500'th word, cut the text at the end of the sentence that word is in
                  const words = cleanedText.split(/\s+/);
                  if (words.length > 1600) {
                    continue;
                  }
                  const first1500Text = words.slice(0, 1500).join(" ");
                  const remaining = words.slice(1500).join(" ");
                  const sentenceEndMatch = remaining.match(/[.!?]/);
                  if (sentenceEndMatch) {
                    cleanedText =
                      first1500Text +
                      remaining.slice(0, sentenceEndMatch.index + 1);
                  } else {
                    cleanedText = first1500Text;
                  }

                  isContentCut = true; // For indicator in frontend
                }

                const summaryObj = await makeSummaryAI(cleanedText);

                if (!summaryObj) {
                  failure = true;
                  break;
                }
                let biasScore = summaryObj.bias_score;
                let qualityScore = summaryObj.quality_score;
                let largeSum = summaryObj.long_summary;
                let tag = summaryObj.tag;
                let bulletSummary = summaryObj.bullet_summary;

                if (largeSum.toLowerCase() === "cookie") {
                  console.error("AI's summary = 'cookie', skipped");
                  continue;
                }

                let contentNL = null;
                let artTitle = article.title;
                try {
                  if (lang === "NL") {
                    contentNL = cleanedText;
                    const translatedTitle = await translate(article.title, {
                      from: "nl",
                      to: "en",
                    });
                    artTitle = translatedTitle.text;

                    const chunkedText = chunkText(cleanedText);
                    const translatedContent = [];
                    for (const chunk of chunkedText) {
                      const translatedChunk = await translate(chunk, {
                        from: "nl",
                        to: "en",
                      });
                      translatedContent.push(translatedChunk.text);
                      await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                    cleanedText = translatedContent.join(" ");
                  }
                } catch {
                  console.log("Translation failed, skipping");
                  continue;
                }

                await Articles[lang].create({
                  title: artTitle,
                  publisher: article.siteName,
                  content: cleanedText,
                  contentNL: contentNL,
                  excerpt: article.excerpt,
                  wordCount: count,
                  language: article.lang,
                  link: linkReturned,
                  imageLink: imageLinkReturned,
                  biasScoreAI: biasScore,
                  qualityScoreAI: qualityScore,
                  longSummaryAI: largeSum,
                  bulletSummaryAI: bulletSummary,
                  tag: tag,
                  date: finalDate,
                  author: author,
                  isContentCut: isContentCut,
                });
                successfulArticles++;
              } catch (e) {
                console.error(e);
              }
            } else {
              if (count <= minWordCount) {
                console.error(
                  `Extraction stopped. Word count too short: ${count}\n `
                );
              }
            }
          }
        } catch (err) {
          console.log(`Extraction error: ${err.message} \n`);
        }
      }
      if (!pageNum) {
        console.log(
          "Last page of API reached (new nextPage value not provided), exiting )"
        );
        return;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 10000);
      });
    }
  } catch (err) {
    console.error(`Puppeteer launch fault (main try block fault): ${err}`);
  } finally {
    if (page && !page.isClosed()) await page.close().catch(() => {});
    page = null;
    if (browser) {
      await browser.close();
    }
  }
}

// Written By AI: ----------------------------------

async function autoScroll(page, scrollContainerSelector = null) {
  await page.evaluate(async (selector) => {
    await new Promise((resolve) => {
      const baseDistance = 400;
      const baseDelay = 100;
      const maxNoChange = 50;

      const startUrl = window.location.href;
      let noChangeCount = 0;
      let lastScrollPosition = 0;

      let scroller;
      let isWindow = false;

      if (selector) {
        scroller = document.querySelector(selector);
        if (!scroller) {
          isWindow = true;
        }
      } else {
        isWindow = true;
      }

      const getScrollPos = () => {
        if (isWindow) {
          const el =
            document.scrollingElement ||
            document.documentElement ||
            document.body;
          return el.scrollTop;
        }
        return scroller.scrollTop;
      };

      const getScrollHeight = () => {
        if (isWindow) {
          const el =
            document.scrollingElement ||
            document.documentElement ||
            document.body;
          return el.scrollHeight;
        }
        return scroller.scrollHeight;
      };

      const doScroll = (amount) => {
        if (isWindow) {
          window.scrollBy(0, amount);
        } else {
          scroller.scrollBy(0, amount);
        }
      };

      const scrollStep = () => {
        if (window.location.pathname !== new URL(startUrl).pathname) {
          resolve();
          return;
        }

        const actualDistance =
          baseDistance + Math.floor(Math.random() * 40) - 20;
        doScroll(actualDistance);

        const currentScrollPosition = getScrollPos();
        const totalScrollHeight = getScrollHeight();

        if (Math.abs(currentScrollPosition - lastScrollPosition) <= 1) {
          noChangeCount++;
        } else {
          noChangeCount = 0;
          lastScrollPosition = currentScrollPosition;
        }

        if (noChangeCount >= maxNoChange) {
          resolve();
          return;
        }

        if (currentScrollPosition > 50000) {
          resolve();
          return;
        }

        const actualDelay = baseDelay + Math.floor(Math.random() * 70) - 20;
        setTimeout(scrollStep, actualDelay);
      };

      scrollStep();
    });
  }, scrollContainerSelector);
}

// Function for text chunking by 2k chars

function chunkText(text) {
  const chunks = [];

  while (text.length > 2000) {
    // Find the last space within the limit
    let splitIndex = text.lastIndexOf(" ", 2000);

    // If no space is found (a single 2000+ char word), force a hard cut
    if (splitIndex === -1) {
      splitIndex = 2000;
    }

    // Push the chunk and remove it from the original text
    chunks.push(text.substring(0, splitIndex));
    text = text.substring(splitIndex).trim();
  }

  if (text.length > 0) {
    chunks.push(text);
  }

  return chunks;
}

// End of AI created function ----------------------------------

async function makeSummaryAI(articleContent) {
  const NewsSummary = z.object({
    bias_score: z
      .string()
      .describe(
        "Generate a bias score for the original article content. Access it based on how strongly and opinionated the article is, and if it does not include relevant points from the opposite side of the argument. Use your judgement. OUTPUT ONLY A SINGLE DIGIT AS A SCORE (values: lowest bias: 1, highest bias: 10), example: 7."
      ),
    quality_score: z
      .string()
      .describe(
        "Generate an overall quality score. Guiding question: Is the content of the article relevant, how important is it to readers, and how well does the article describe the issue? OUTPUT ONLY A SINGLE DIGIT AS A SCORE (values: worst: 1, best: 10), example: 6."
      ),
    long_summary: z
      .string()
      .describe(
        "A highly efficient, neutral summary of the article. 2-3 paragraphs (decide size of each paragraph based on the length of the overall article - shorter article, shorter paragraphs, longer article, longer paragraphs). Capture all the 'who, what, where, when. Note: If the article does not seem to come from a news article/report (for example the article (input) lists information about a site's cookies policy or SOLELY contains an advertisement without any 'real' content (the article is still valid if only a small part of it is an advertisement/cookie policy)), you MUST type only ONE word: 'cookie'. Use citations if they were in the source (e.g. According to XYZ,). If article content was provided in Dutch, always translate summaries to English."
      ),
    bullet_summary: z
      .array(z.string())
      .describe(
        `Generate exactly 5 bullet points summarizing the most critical concepts from this article. Each bullet must be a single, concise sentence (10-15 words maximum). Prioritize: key events, main actors, significant outcomes, and essential context. Avoid filler words and redundancy. Use citations where present in the source (e.g., "According to XYZ,"). Note: If the article does not appear to be a news article/report (e.g., cookie policy, terms of service, or purely advertisement without substantive content), respond with only: 'cookie'.If article content was provided in Dutch, always translate summaries to English.`
      ),
    tag: z
      .string()
      .describe(
        `Read the following article text and output ONLY a single, concise, professional tag that best describes the main topic or intersection of topics. Rules: Maximum 3 words (example: "AI & Finance"), use "&" instead of "and" when combining two fields, use title case, never add quotes, brackets, explanations, or any extra text, if it's purely one field, just write that field (e.g. "Quantum Computing"). Tags must always be in English.`
      ),
  });

  try {
    const response = await openai.responses.parse({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "You are a news editor. Summarize the given article and provide appropriate ratings.",
        },
        {
          role: "user",
          content: articleContent.substring(0, 10000),
        },
      ],
      text: {
        format: zodTextFormat(NewsSummary, "news_summary"),
      },
    });
    return response.output_parsed;
  } catch (error) {
    console.error("Summarization failed:", error.message);
    return null;
  }
}

let isRunning = false;
cron.schedule("0 0 * * *", async () => {
  const now = new Date();

  console.log(
    now.toLocaleString("en-GB", {
      timeZone: "UTC",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  );

  if (isRunning) {
    console.log("Daily job already running");
    return;
  }
  isRunning = true;

  try {
    if (mongoose.connection.readyState === 1) {
      console.log("Running Daily File Moving Schedule");
      await archiveDailyNews("EN");
      await archiveDailyNews("NL");
      await extractText("EN");
      await extractText("NL");
    } else if (mongoose.connection.readyState === 0) {
      try {
        console.log("Retrying daily schedule");
        await connectDB();
        if (mongoose.connection.readyState === 1) {
          console.log("Running Daily File Moving Schedule");
          await archiveDailyNews("EN");
          await archiveDailyNews("NL");
          await extractText("EN");
          await extractText("NL");
        } else {
          throw new Error("Second try unsuccessful");
        }
      } catch (e) {
        throw new Error(
          `Database connection failure, unable to complete today's (${new Date().toISOString()}) maintenance! Additional context: ${e}`
        );
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      if (mongoose.connection.readyState === 1) {
        console.log("Running Daily File Moving Schedule");
        await archiveDailyNews("EN");
        await archiveDailyNews("NL");
        await extractText("EN");
        await extractText("NL");
      } else {
        throw new Error(
          `Connection to database failed: ${mongoose.connection.readyState}`
        );
      }
    }
  } catch (e) {
    console.error("Daily maintenance failure\n");
    console.error(e);
  } finally {
    isRunning = false;
  }
});
