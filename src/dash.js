// ---------------------------------------------------------- Functions ---------------------------------------------

// Helper function for score coloring
function colorScoreElement(el, rawScore, highIsGood) {
  if (!el) return;
  const intScore = parseInt(rawScore, 10);

  let colorClass;
  if (highIsGood) {
    // Quality score: high = green, low = red
    if (intScore >= 7) {
      colorClass = "score-num-low"; // green
    } else if (intScore >= 4) {
      colorClass = "score-num-mid"; // orange
    } else {
      colorClass = "score-num-high"; // red
    }
  } else {
    // Bias score: high = red, low = green
    if (intScore <= 3) {
      colorClass = "score-num-low"; // green
    } else if (intScore <= 7) {
      colorClass = "score-num-mid"; // orange
    } else {
      colorClass = "score-num-high"; // red
    }
  }

  el.innerHTML = `<span class="${colorClass}">${intScore}</span>/10`;
}

// --- Helper for showing the email verification banner ---
function showVerificationBanner() {
  verificationBanner.classList.remove("hidden");
}

// --- Helper for hiding the verification banner ---
function hideVerificationBanner() {
  verificationBanner.classList.add("hidden");
}

// --- Show toast function ---
function showToast(type, title, message, duration = 4000) {
  const container = document.getElementById("toast-container");

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icons = {
    success: "ph-check-circle",
    error: "ph-x-circle",
    warning: "ph-warning-circle",
    info: "ph-info",
  };

  toast.innerHTML = `
    <div class="toast-icon">
      <i class="ph-fill ${icons[type] || icons.info}"></i>
    </div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" aria-label="Close notification">
      <i class="ph ph-x"></i>
    </button>
    <div class="toast-progress" style="animation: toast-progress ${duration}ms linear forwards"></div>
  `;

  container.appendChild(toast);

  // Close toaster button functionality
  const closeBtn = toast.querySelector(".toast-close");
  closeBtn.addEventListener("click", () => dismissToast(toast));

  // Trigger show animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });
  });

  // Auto-dismiss
  let timeoutId = setTimeout(() => dismissToast(toast), duration);

  // Pause on hover
  toast.addEventListener("mouseenter", () => {
    clearTimeout(timeoutId);
  });

  // --- Continue toaster animation and leaving procedure after user drags off mouse
  toast.addEventListener("mouseleave", () => {
    const progress = toast.querySelector(".toast-progress");
    const computedStyle = getComputedStyle(progress);
    const remainingWidth =
      parseFloat(
        computedStyle.transform.split(",")[0].replace("matrix(", "")
      ) || 0;
    const remainingTime = remainingWidth * duration;

    if (remainingTime > 0) {
      timeoutId = setTimeout(() => dismissToast(toast), remainingTime);
    } else {
      dismissToast(toast);
    }
  });

  return toast;
}

// --- Hide toast function ---
function dismissToast(toast) {
  if (!toast || toast.classList.contains("hiding")) return;

  toast.classList.remove("show");
  toast.classList.add("hiding");

  setTimeout(() => {
    toast.remove();
  }, 400);
}

// -- Reset reaction states when navigating --
function resetReactionButtons() {
  if (localStorage.getItem(currentArticleId)) {
    updateAllSaveBtns(true);
  } else {
    updateAllSaveBtns(false);
  }
  feedbackBtnElem.classList.remove("active");
  feedbackBtnElem.innerHTML = '<i class="ph ph-seal-warning"></i>';
}

// -- load overlay in favorites view ---
function openFavoriteArticleOverlay(article, index) {
  const overlay = document.getElementById("article-overlay");

  // Remove closing class if present (prevents animation conflicts)
  overlay.classList.remove("closing");

  // Load overlay content for favorite article
  const overlayPub = document.getElementById("article-doc-source-badge");

  if (overlayPub.classList.contains("hide")) {
    overlayPub.classList.remove("hide");
  }

  document.getElementById("overlay-title-small").innerText = article.title;
  document.getElementById(
    "overlay-image"
  ).style.backgroundImage = `url('${article.imageLink}')`;
  document.getElementById("overlay-tag").innerText = article.tag;
  document.getElementById("overlay-source").innerText = article.publisher || "";

  if (!article.publisher) {
    overlayPub.classList.add("hide");
  }

  // Calculate time ago
  const parsedDate = new Date(article.date?.replace(" ", "T") || Date.now());
  const diffHours = (Date.now() - parsedDate) / (1000 * 60 * 60);
  const timeAgo =
    diffHours > 24
      ? `${Math.round(diffHours / 24)} days ago`
      : `${Math.round(diffHours)} hours ago`;

  document.getElementById("overlay-date").innerText = timeAgo;
  document.getElementById("overlay-title").innerText = article.title;
  document.getElementById("overlay-summary").innerText =
    article.longSummaryAI || "";
  document.getElementById("overlay-full-content").innerText = article.content;
  setLanguageToggleContent("en");

  if (article.isContentCut) {
    // Display warning of cut content
    document.getElementById("wordCountDisclaimer").classList.add("show");
  } else {
    document.getElementById("wordCountDisclaimer").classList.remove("show");
  }
  document.getElementById("overlay-url").href = article.link || "#";

  // Update overlay scores (and color first number)
  if (article.biasScoreAI) {
    colorScoreElement(
      document.getElementById("overlay-bias-score"),
      article.biasScoreAI,
      false
    );
    colorScoreElement(
      document.getElementById("overlay-quality-score"),
      article.qualityScoreAI,
      true
    );
  } else {
    document.getElementById("overlay-bias-score").innerHTML = "In paid plans";
    document.getElementById("overlay-quality-score").innerHTML =
      "In paid plans";
  }

  // Bullet points
  const overlayBulletSummary = document.getElementById(
    "overlay-bullet-summary"
  );
  if (article.bulletSummaryAI && article.bulletSummaryAI.length > 0) {
    overlayBulletSummary.innerHTML = article.bulletSummaryAI
      .map(
        (item) => `
      <li class="key-point-item">
        <div class="key-point-bullet">
          <i class="ph ph-square-logo"></i>
        </div>
        <span class="key-point-text">${item}</span>
      </li>
    `
      )
      .join("");
  }

  // Author
  const overlayAuthorByline = document.getElementById("overlay-author-byline");
  if (article.author) {
    overlayAuthorByline.classList.remove("hide");
    document.getElementById("author-tag-overlay").innerText = article.author;
  } else {
    overlayAuthorByline.classList.add("hide");
  }
  updateOverlayContentFavorites(index);
  // Open overlay
  document.getElementById("article-doc-body").scrollTop = 0;
  overlay.classList.add("active");
  document.body.style.overflow = "hidden";
}

// -- Function for smart sidebar resize (auto-close/open) --
function checkScreenSize() {
  try {
    document.getElementById("welcome-msg").style.transition = "none";
    document.getElementById("secret-msg").style.transition = "none";
    document.getElementById("welcome-msg").classList.add("hide");
    document.getElementById("secret-msg").classList.add("hide");
    openSideBtns.forEach((e) => {
      e.style.marginBottom = "5px";
    });
    document.getElementById("verification-banner").classList.add("move");
    document.getElementById("welcome-msg").style.display = "none";
    document.getElementById("secret-msg").style.display = "none";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Disable transition
        document.getElementById("top-bar-wrapper").style.transition = "none";

        // Make the changes
        document.getElementById("top-bar-wrapper").classList.add("height");
        document.getElementById("top-bar-wrapper").style.marginBottom = "-18px";

        // Force reflow so the change applies immediately
        void document.getElementById("top-bar-wrapper").offsetHeight;

        // Re-enable transition
        document.getElementById("top-bar-wrapper").style.transition = "";
        document.getElementById("welcome-msg").style.transition = "";
        document.getElementById("secret-msg").style.transition = "";
      });
    });
  } catch {}
  if (window.innerWidth < 750) {
    if (isFeedOpen) {
      document.getElementById("main-content").style.paddingTop = "13px";
    } else {
      document.getElementById("main-content").style.paddingTop = "20px";
    }
    root.style.setProperty("--sidebar-width", "0px");
    sidebar.classList.add("closed");
    closeSideElem.classList.add("hide");
    openSideBtns.forEach((btn) => btn.classList.add("show"));
  } else if (window.innerWidth >= 750) {
    if (isFeedOpen) {
      document.getElementById("main-content").style.paddingTop = "20px";
    } else {
      document.getElementById("main-content").style.paddingTop = "40px";
    }
    root.style.setProperty("--sidebar-width", "260px");
    sidebar.classList.remove("closed");
    closeSideElem.classList.remove("hide");
    openSideBtns.forEach((b) => b.classList.remove("show"));
  }
}

// --- Initialization to allow to click on card to view article ---
let trueIndex;
function initFavoriteCardHandlers() {
  document.querySelectorAll(".favorite-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      // Don't trigger if clicking remove button
      if (e.target.closest(".fav-card-remove")) return;

      const articleId = card.dataset.articleId;
      trueIndex = starredArt.savedArticles.findIndex(
        (a) => a._id === articleId
      );
      const article = starredArt.savedArticles.find((a) => a._id === articleId);

      if (article) {
        currentArticleId = article._id;
        currentArticleLink = article.link;
        currentArticleObj = article;
        updateAllSaveBtns(true); // All favorites are saved
        openFavoriteArticleOverlay(article, trueIndex);
      }
    });
  });

  // Remove from favorites
  document.querySelectorAll(".fav-card-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const articleId = btn.dataset.id;
      const card = btn.closest(".favorite-card");

      // Add removing animation
      card.classList.add("removing");

      try {
        const response = await fetch("/api/refresh/save-article", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artId: articleId,
            email: document.getElementById("emailUserDisabled").value,
            action: 2,
          }),
        });

        if (response.ok) {
          localStorage.removeItem(articleId);

          // Remove from savedArticles array
          const articleIndex = starredArt.savedArticles.findIndex(
            (a) => a._id === articleId
          );
          if (articleIndex > -1) {
            starredArt.savedArticles.splice(articleIndex, 1);
          }

          // Remove card with animation
          setTimeout(() => {
            card.remove();

            // Check if grid is now empty
            const grid = document.getElementById("favorites-grid");
            if (grid.children.length === 0) {
              document.getElementById("empty-favorites").style.display = "flex";
              document.getElementById("favorites-grid").style.display = "none";
            } else {
              document.getElementById("favorites-grid").style.display = "";
            }
          }, 300);
        } else {
          card.classList.remove("removing");
          showToast("error", "Error", "Failed to remove article.");
        }
      } catch (error) {
        card.classList.remove("removing");
        showToast(
          "error",
          "Connection Error",
          "Please check your internet connection and try again."
        );
      }
    });
  });
}

// --- Load article overlay data ---
function updateOverlayContentFavorites(trueIndex) {
  const article = starredArt.savedArticles[trueIndex]; // Instead of the regular article array, get the array of favorite articles from server

  // Update the current article tracking
  currentArticleId = article._id;
  currentArticleLink = article.link;
  currentArticleObj = article;

  if (overlayPub.classList.contains("hide")) {
    overlayPub.classList.remove("hide");
  }

  // Handle overlay author display
  const overlayAuthorByline = document.getElementById("overlay-author-byline");

  if (article.author) {
    const wordArtCount =
      article.author.trim() === ""
        ? 0
        : article.author.trim().split(/\s+/).length;
    if (wordArtCount < 4 && !article.author.includes("@")) {
      const authorInfo = article.author
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "); // capitalize first letter and join words back into a complete thing
      overlayAuthorByline.classList.remove("hide");
      document.getElementById("author-tag-overlay").innerText = authorInfo;
    } else overlayAuthorByline.classList.add("hide");
  } else {
    overlayAuthorByline.classList.add("hide");
  }

  document.getElementById("overlay-title-small").innerText = article.title;
  document.getElementById(
    "overlay-image"
  ).style.backgroundImage = `url('${article.imageLink}')`;
  document.getElementById("overlay-tag").innerText = article.tag;
  document.getElementById("overlay-source").innerText = article.publisher;
  if (!article.publisher) {
    overlayPub.classList.add("hide");
  }
  if (article.isContentCut) {
    // Display warning of cut content
    document.getElementById("wordCountDisclaimer").classList.add("show");
  } else {
    document.getElementById("wordCountDisclaimer").classList.remove("show");
  }
  // Calculate how long ago was created
  const parsedDate = new Date(article.date?.replace(" ", "T") || Date.now());
  const diffHours = (Date.now() - parsedDate) / (1000 * 60 * 60);
  const timeAgo =
    diffHours > 24
      ? `${Math.round(diffHours / 24)} days ago`
      : `${Math.round(diffHours)} hours ago`;

  document.getElementById("overlay-date").innerText = timeAgo;

  document.getElementById("overlay-title").innerText = article.title;
  document.getElementById("overlay-summary").innerText = article.longSummaryAI;
  document.getElementById("overlay-full-content").innerText = article.content;
  document.getElementById("overlay-url").href = article.link;

  // Update overlay scores (and color first number)
  if (article.biasScoreAI) {
    colorScoreElement(
      document.getElementById("overlay-bias-score"),
      article.biasScoreAI,
      false
    );
    colorScoreElement(
      document.getElementById("overlay-quality-score"),
      article.qualityScoreAI,
      true
    );
  } else {
    document.getElementById("overlay-bias-score").innerHTML = "In paid plans";
    document.getElementById("overlay-quality-score").innerHTML =
      "In paid plans";
  }

  // Update bullet summary in overlay
  const overlayBulletSummary = document.getElementById(
    "overlay-bullet-summary"
  );
  overlayBulletSummary.innerHTML = (article.bulletSummaryAI || [])
    .map(
      (item) => `
                        <li class="key-point-item">
                          <div class="key-point-bullet">
                            <i class="ph ph-square-logo"></i>
                          </div>
                          <span class="key-point-text">${item}</span>
                        </li>
                      `
    )
    .join("");
  overlayCounter.innerText = `${trueIndex + 1} / ${
    starredArt.savedArticles.length
  }`;
  if (resetEnabled) {
    articleDocBody.scrollTop = 0;
  }
}

// --- Loads main feed page and user info ---
async function loadDashboard() {
  let reloadFeedElem;
  try {
    let response = await fetch("/api/user-data", {
      method: "GET",
      credentials: "include",
    });
    if (!response.ok) {
      const refreshResp = await fetch("/api/refresh", {
        method: "GET",
        credentials: "include",
      });
      if (refreshResp.ok) {
        response = await fetch("/api/user-data", {
          method: "GET",
          credentials: "include",
        });
      } else {
        response = await fetch("/api/refresh/logout");
        throw new Error();
      }
    }
    data = await response.json();

    if (data.isDeactivated) {
      // Hide loader, show deletion page instead of app
      document.getElementById("loader").style.display = "none";
      document.getElementById("app").style.display = "none";

      const deletionPage = document.getElementById("deletion-pending-page");
      deletionPage.classList.remove("hidden");

      // Update support email if available
      if (data.contactEmail) {
        const supportLink = document.getElementById("deletion-support-email");
        supportLink.href = `mailto:${data.contactEmail}`;
        supportLink.textContent = "Contact Support";
      }

      // Parse and display the deletion date
      const deleteDate = new Date(data.deleteAt);
      const dateOptions = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      };
      document.getElementById("deletion-date-display").textContent =
        deleteDate.toLocaleDateString("en-US", dateOptions);

      // Countdown update function
      function updateDeletionCountdown() {
        const now = new Date();
        const diff = deleteDate - now;

        if (diff <= 0) {
          // Deletion time has passed
          document.getElementById("countdown-days-left").textContent = "0";
          document.getElementById("countdown-hours-left").textContent = "0";
          document.getElementById("countdown-minutes-left").textContent = "0";
          return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor(
          (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
        );
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        document.getElementById("countdown-days-left").textContent = days;
        document.getElementById("countdown-hours-left").textContent = hours
          .toString()
          .padStart(2, "0");
        document.getElementById("countdown-minutes-left").textContent = minutes
          .toString()
          .padStart(2, "0");
      }

      // Initial countdown update and interval
      updateDeletionCountdown();
      const countdownInterval = setInterval(updateDeletionCountdown, 60000); // Update every minute

      // Cancel Deletion Button Handler
      document
        .getElementById("cancel-deletion-btn")
        .addEventListener("click", async () => {
          const btn = document.getElementById("cancel-deletion-btn");
          const originalContent = btn.innerHTML;

          btn.disabled = true;
          btn.innerHTML =
            '<i class="ph ph-spinner ph-spin"></i> Restoring Account...';

          try {
            const response = await fetch("/api/refresh/cancel-deletion", {
              method: "POST",
              credentials: "include",
            });

            if (response.ok) {
              clearInterval(countdownInterval);
              btn.innerHTML = '<i class="ph ph-check"></i> Account Restored!';
              btn.style.background =
                "linear-gradient(135deg, #22c55e, #16a34a)";

              showToast(
                "success",
                "Account Restored",
                "Your account deletion has been canceled. Redirecting..."
              );

              setTimeout(() => {
                window.location.reload();
              }, 2000);
            } else if (response.status === 403) {
              showToast("info", "Session Expired", "Please log in again.");
              setTimeout(() => {
                window.location.href = "/log-in";
              }, 1000);
            } else {
              throw new Error("Failed to cancel deletion");
            }
          } catch (error) {
            console.error("Cancel deletion error:", error);
            showToast(
              "error",
              "Error",
              "Failed to cancel deletion. Please try again or contact support."
            );
            btn.disabled = false;
            btn.innerHTML = originalContent;
          }
        });

      // Logout Anyway Button Handler
      document
        .getElementById("logout-anyway-btn")
        .addEventListener("click", async () => {
          const btn = document.getElementById("logout-anyway-btn");
          btn.disabled = true;
          btn.innerHTML =
            '<i class="ph ph-spinner ph-spin"></i> Logging out...';

          try {
            await fetch("/api/refresh/logout", {
              credentials: "include",
            });
            window.location.href = "/log-in";
          } catch (error) {
            window.location.href = "/log-in";
          }
        });

      return; // Stop loading the rest of the dashboard
    }

    document.getElementById(
      "help-item-contact"
    ).innerHTML = `<i class="ph ph-question"></i><span>Have billing questions? Contact us at
    <a target="_blank" href="mailto:${data.contactEmail}"
                      >${data.contactEmail}</a
                    ></span
                  >`;

    if (data.welcome) {
      showWelcomeBanner(data.name);
    }
    try {
      const starRes = await fetch("/api/refresh/load-stars", {
        method: "GET",
        credentials: "include",
      });
      let starResData;
      if (starRes.ok) {
        starResData = await starRes.json();
        const savedIds = new Set(starResData.savedArticles.map((e) => e._id));
        for (const article of data.articles) {
          if (savedIds.has(article._id)) {
            localStorage.setItem(article._id, true);
          } else if (localStorage.getItem(article._id)) {
            localStorage.removeItem(article._id);
          }
        }
      }
    } catch {}

    if (data.lang === "en") {
      document.getElementById("langContentGroupSmall").style.display = "none";
      document.querySelector(".article-doc-divider-2").style.background =
        "transparent";
    }

    const emailStatus = document.getElementById("emailVerifiedStatus");
    const verifyEmailRow = document.getElementById("verifyEmailRow");
    const verifyEmailBtn = document.getElementById("verifyEmailBtn");

    verifyEmailBtn.addEventListener("click", async () => {
      const btn = verifyEmailBtn;
      const originalContent = btn.innerHTML;

      btn.disabled = true;
      btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Sending...';

      try {
        const response = await fetch("/resend-verification", {
          method: "POST",
          credentials: "include",
        });

        if (response.ok) {
          btn.innerHTML = '<i class="ph ph-check"></i> Email Sent!';

          setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.disabled = false;
          }, 60000);
        } else {
          throw new Error("Failed to resend");
        }
      } catch (error) {
        btn.innerHTML = '<i class="ph ph-warning"></i> Failed';
        showToast(
          "error",
          "Unexpected Error",
          "Something went wrong. Unable to process this request."
        );

        setTimeout(() => {
          btn.innerHTML = originalContent;
          btn.disabled = false;
        }, 60000);
      }
    });

    if (!data.verified) {
      showVerificationBanner();
      emailStatus.classList.remove("verified");
      emailStatus.classList.add("not-verified");
      emailStatus.innerHTML =
        'Not Verified<i class="ph-fill ph-warning-circle verifiedIcon"></i>';
      emailStatus.title = "Email not verified";
      verifyEmailRow.style.display = "flex";
    } else {
      emailStatus.classList.remove("not-verified");
      emailStatus.classList.add("verified");
      emailStatus.innerHTML =
        'Verified<i class="ph-fill ph-check-circle verifiedIcon"></i>';
      emailStatus.title = "Email verified";
      hideVerificationBanner();
      verifyEmailRow.style.display = "none";
    }

    document.getElementById("emailUserDisabled").value = data.email;

    document.getElementById("welcome-msg").innerText = `Welcome, ${data.name}`;
    document.getElementById("currentNameDisplay").innerText = data.name;
    document.getElementById("nameInput").value = data.name;
    window.currentUserName = data.name;
    document.getElementById(
      "secret-msg"
    ).innerText = `Plan: ${data.secretInfo}`;
    currentLang = data.lang;
    setLanguageToggle(data.lang);
    document.getElementById("loader").style.display = "none";
    document.getElementById("app").style.display = "flex";

    if (data.authProvider === "google") {
      document.getElementById("changePasswordBtn").disabled = true;
      document.getElementById("changePasswordBtn").classList.add("disabled");
      document.getElementById("passNote").classList.add("show");
    }

    contentNews = data.articles || [];

    if (contentNews.length === 0) {
      // If no news received from server (Article is empty)
      // Show empty state, and ability to reload
      document.getElementById("news-title").innerText =
        "No articles available yet";
      document.getElementById(
        "news-body"
      ).innerHTML = `<p>Check back soon for fresh content!</p><button class="reloadFeed" id="reloadFeed"><i class="ph ph-arrows-clockwise"></i>Reload Feed</button>`;
      reloadFeedElem = document.getElementById("reloadFeed");
      document.getElementById("counter").innerText = "0 / 0"; // Set control's counter to 0
      document.getElementById("card-meta").style.display = "none"; // Hide card-meta
      document.getElementById("score-badges").style.display = "none"; // Hide score-badges
      document.getElementById("feed-controls").style.display = "none"; // Hide controls
      document.getElementById("view-feed").style.marginBottom = "40px"; // Increase space for scrolling and symmetry
      document.getElementById("news-link").style.display = "none";
      document.getElementById("news-title").style.textAlign = "center"; // Center title
      document.getElementById("news-body").style.textAlign = "center"; // Center text
      if (reloadFeedElem) {
        reloadFeedElem.style.display = "inline-flex";
        reloadFeedElem.addEventListener("click", async () => {
          reloadFeedElem.disabled = true;
          try {
            let response = await fetch("/api/user-data", {
              method: "GET",
              credentials: "include",
            });
            if (!response.ok) {
              const refreshResp = await fetch("/api/refresh", {
                method: "GET",
                credentials: "include",
              });
              if (refreshResp.ok) {
                response = await fetch("/api/user-data", {
                  method: "GET",
                  credentials: "include",
                });
              } else {
                await fetch("/logout");
                showToast("info", "Session Expired", "Please log in again.");
                setTimeout(() => {
                  window.location.href = "/log-in";
                }, 1000);
                throw new Error();
              }
            }
            const refreshedData = await response.json();
            contentNews = refreshedData.articles || [];

            if (contentNews.length !== 0) {
              document.getElementById("view-feed").style.marginBottom = "0px";
              document.getElementById("card-meta").style.display = "flex"; // Show card-meta
              document.getElementById("score-badges").style.display = "flex"; // Show score-badges
              document.getElementById("feed-controls").style.display = "flex"; // Show controls
              document.getElementById("news-link").style.display =
                "inline-flex";
              document.getElementById("news-title").style.textAlign = "";
              document.getElementById("news-body").style.textAlign = "";
              document.getElementById("reloadFeed").style.display = "none";
              const nowCardId = localStorage.getItem("currentArticleId");
              const nowCardIndex = localStorage.getItem("currentIndex");
              const filter = contentNews.filter((e) => e._id === nowCardId);
              if (filter.length === 0 || !nowCardIndex) {
                renderCard(0);
              } else {
                renderCard(parseInt(nowCardIndex, 10));
              }
            } else {
              showToast(
                "info",
                "Nope, still not here",
                "There are currently no available articles to display."
              );
            }
          } catch (e) {
            document.getElementById("back-link").style.display = "flex";
          }
          setTimeout(() => {
            reloadFeedElem.disabled = false;
          }, 3000);
        });
      }

      return; // Calling renderCard with no articles will cause a crash
    }
    document.getElementById("view-feed").style.marginBottom = "0px";
    document.getElementById("card-meta").style.display = "flex"; // Show card-meta
    document.getElementById("score-badges").style.display = "flex"; // Show score-badges
    document.getElementById("feed-controls").style.display = "flex"; // Show controls
    document.getElementById("news-link").style.display = "inline-flex";
    document.getElementById("news-title").style.textAlign = "";
    document.getElementById("news-body").style.textAlign = "";
    if (reloadFeedElem) {
      reloadFeedElem.style.display = "none";
    }

    const nowCardId = localStorage.getItem("currentArticleId");
    const nowCardIndex = localStorage.getItem("currentIndex");
    const filter = contentNews.filter((e) => e._id === nowCardId);
    if (filter.length === 0 || !nowCardIndex) {
      // Probably processing a new batch of articles or first user login
      renderCard(0);
    } else {
      // Getting where the user stopped last time
      renderCard(parseInt(nowCardIndex, 10));
    }
  } catch (e) {
    document.getElementById("back-link").style.display = "flex";
  }
}

// --- Rotate auth tokens function ---
async function checkSession() {
  try {
    const response = await fetch("/api/refresh", {
      method: "GET",
      credentials: "include",
    });
    if (response.status === 401 || response.status === 403) {
      showToast("info", "Session Expired", "Please log in again.");
      setTimeout(() => {
        window.location.href = "/log-in";
      }, 1000);
    }
  } catch (e) {
    console.error(e);
  }
}

// --- Load article overlay data ---
function updateOverlayContent(index) {
  const article = contentNews[index];
  if (overlayPub.classList.contains("hide")) {
    overlayPub.classList.remove("hide");
  }

  // Handle overlay author display
  const overlayAuthorByline = document.getElementById("overlay-author-byline");

  if (article.author) {
    const wordArtCount =
      article.author.trim() === ""
        ? 0
        : article.author.trim().split(/\s+/).length;
    if (wordArtCount < 4 && !article.author.includes("@")) {
      let authorInfo = article.author
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "); // capitalize first letter and join words back into a complete thing
      overlayAuthorByline.classList.remove("hide");
      document.getElementById("author-tag-overlay").innerText = authorInfo;
    } else overlayAuthorByline.classList.add("hide");
  } else {
    overlayAuthorByline.classList.add("hide");
  }

  document.getElementById("overlay-title-small").innerText = article.title;
  document.getElementById(
    "overlay-image"
  ).style.backgroundImage = `url('${article.imageLink}')`;
  document.getElementById("overlay-tag").innerText = article.tag;
  document.getElementById("overlay-source").innerText = article.publisher;
  if (!article.publisher) {
    overlayPub.classList.add("hide");
  }
  if (article.isContentCut) {
    // Display warning of cut content
    document.getElementById("wordCountDisclaimer").classList.add("show");
  } else {
    document.getElementById("wordCountDisclaimer").classList.remove("show");
  }
  // Calculate how long ago was created
  const parsedDate = new Date(article.date?.replace(" ", "T") || Date.now());
  const diffHours = (Date.now() - parsedDate) / (1000 * 60 * 60);
  const timeAgo =
    diffHours > 24
      ? `${Math.round(diffHours / 24)} days ago`
      : `${Math.round(diffHours)} hours ago`;

  document.getElementById("overlay-date").innerText = timeAgo;

  document.getElementById("overlay-title").innerText = article.title;
  document.getElementById("overlay-summary").innerText = article.longSummaryAI;
  document.getElementById("overlay-full-content").innerText = article.content;
  document.getElementById("overlay-url").href = article.link;

  // Update overlay scores (and color first number)
  if (article.biasScoreAI) {
    colorScoreElement(
      document.getElementById("overlay-bias-score"),
      article.biasScoreAI,
      false
    );
    colorScoreElement(
      document.getElementById("overlay-quality-score"),
      article.qualityScoreAI,
      true
    );
  } else {
    document.getElementById("overlay-bias-score").innerHTML = "In paid plans";
    document.getElementById("overlay-quality-score").innerHTML =
      "In paid plans";
  }

  // Update bullet summary in overlay
  const overlayBulletSummary = document.getElementById(
    "overlay-bullet-summary"
  );
  overlayBulletSummary.innerHTML = article.bulletSummaryAI
    .map(
      (item) => `
                        <li class="key-point-item">
                          <div class="key-point-bullet">
                            <i class="ph ph-square-logo"></i>
                          </div>
                          <span class="key-point-text">${item}</span>
                        </li>
                      `
    )
    .join("");
  index++;
  overlayCounter.innerText = `${index} / ${contentNews.length}`;

  if (resetEnabled) {
    articleDocBody.scrollTop = 0;
  }
}

// --- Helper for opening overlay ---
function openArticleOverlay(index) {
  // Remove closing class if present
  articleOverlay.classList.remove("closing");

  updateOverlayContent(index);
  articleDocBody.scrollTop = 0;
  articleOverlay.classList.add("active");
  document.body.style.overflow = "hidden";
}

// --- Closing overlay ---
function closeArticleOverlay() {
  setLanguageToggleContent("en");
  // Add a closing class for animation
  articleOverlay.classList.add("closing");

  // Wait for animation to complete, then clean up
  setTimeout(() => {
    articleOverlay.classList.remove("active");
    articleOverlay.classList.remove("closing");
    document.body.style.overflow = "";

    // Restore nav arrows visibility for main feed
    document.getElementById("overlay-prev-btn").style.display = "";
    document.getElementById("overlay-next-btn").style.display = "";
    document.getElementById("overlay-counter").style.display = "";
  }, 300); // Match this to the CSS transition duration
}

// --- Navigation for overlay ---
function navigateOverlay(direction) {
  setLanguageToggleContent("en");
  if (!isFavoritesOpen) {
    // If favorites view is not open

    if (direction === 1) {
      if (currentIndex < contentNews.length - 1) {
        currentIndex++;
      } else {
        currentIndex = 0;
      }
    } else {
      if (currentIndex > 0) {
        currentIndex--;
      } else {
        currentIndex = contentNews.length - 1;
      }
    }

    const docBody = document.getElementById("article-doc-body");
    docBody.style.opacity = 0;
    docBody.style.transform =
      direction === 1 ? "translateX(20px)" : "translateX(-20px)";

    setTimeout(() => {
      updateOverlayContent(currentIndex);
      renderCard(currentIndex);
      docBody.style.opacity = 1;
      docBody.style.transform = "translateX(0)";
    }, 150);
  } else {
    // If favorite view is open

    if (direction === 1) {
      if (trueIndex < starredArt.savedArticles.length - 1) {
        trueIndex++;
      } else {
        trueIndex = 0;
      }
    } else {
      if (trueIndex > 0) {
        trueIndex--;
      } else {
        trueIndex = starredArt.savedArticles.length - 1;
      }
    }

    const docBody = document.getElementById("article-doc-body");
    docBody.style.opacity = 0;
    docBody.style.transform =
      direction === 1 ? "translateX(20px)" : "translateX(-20px)";

    setTimeout(() => {
      updateOverlayContentFavorites(trueIndex);
      // renderCard(trueIndex);
      docBody.style.opacity = 1;
      docBody.style.transform = "translateX(0)";
    }, 150);
  }
}

// --- Updates info per an individual main news card ---
function renderCard(index, option) {
  // If option is passed, counter display changes a bit
  const article = contentNews[index];
  currentArticleId = article._id;
  currentArticleLink = article.link;
  currentArticleObj = article;
  localStorage.setItem("currentArticleId", currentArticleId);
  localStorage.setItem("currentIndex", index);
  const card = document.getElementById("active-card");
  const cardAuthor = document.getElementById("card-author");

  if (localStorage.getItem(currentArticleId)) {
    updateAllSaveBtns(true);
  } else {
    updateAllSaveBtns(false);
  }

  if (mainPub.classList.contains("hide")) {
    mainPub.classList.remove("hide");
  }

  if (article.author) {
    const wordArtCount =
      article.author.trim() === ""
        ? 0
        : article.author.trim().split(/\s+/).length;
    if (wordArtCount < 4 && !article.author.includes("@")) {
      const authorInfo = article.author
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "); // capitalize first letter and join words back into a complete thing
      cardAuthor.classList.remove("hide");
      document.getElementById("author-tag").innerText = authorInfo;
    } else cardAuthor.classList.add("hide");
  } else {
    cardAuthor.classList.add("hide");
  }

  card.style.opacity = 0;
  card.style.transform = "translateX(10px)";

  setTimeout(() => {
    document.getElementById(
      "news-image"
    ).style.backgroundImage = `url('${article.imageLink}')`;
    document.getElementById("news-tag").innerText = article.tag;
    document.getElementById("news-title").innerText = article.title;
    document.getElementById("news-body").innerHTML = `
                        <ul class="bullet-list">
                          ${article.bulletSummaryAI
                            .map(
                              (item) => `
                              <li class="bullet-item">
                                <div class="bullet-icon">
                                  <i class="ph ph-square-logo"></i>
                                </div>
                                <span class="bullet-text">${item}</span>
                              </li>
                            `
                            )
                            .join(" ")}
                        </ul>
                      `;

    if (!article.publisher) {
      mainPub.classList.add("hide");
    }

    document.getElementById("news-source").innerText = article.publisher;

    // Calculate how long ago was created
    const parsedDate = new Date(article.date?.replace(" ", "T") || Date.now());
    const diffHours = (Date.now() - parsedDate) / (1000 * 60 * 60);
    const timeAgo =
      diffHours > 24
        ? `${Math.round(diffHours / 24)} days ago`
        : `${Math.round(diffHours)} hours ago`;
    document.getElementById("news-date").innerText = timeAgo;
    document.getElementById("overlay-date").innerText = timeAgo;

    // Update rating/score badges (and color first number)
    // Update overlay scores (and color first number)
    if (article.biasScoreAI) {
      colorScoreElement(
        document.getElementById("news-bias-score"),
        article.biasScoreAI,
        false
      );
      colorScoreElement(
        document.getElementById("news-quality-score"),
        article.qualityScoreAI,
        true
      );
    } else {
      document.getElementById("news-bias-score").innerHTML = "In paid plans";
      document.getElementById("news-quality-score").innerHTML = "In paid plans";
    }
    document.getElementById("bias-bar").style.width = `${
      article.biasScoreAI * 10
    }%`;
    document.getElementById("quality-bar").style.width = `${
      article.qualityScoreAI * 10
    }%`;

    if (option) {
      document.getElementById(
        "counter"
      ).innerText = `${index} / ${contentNews.length}`;
    } else {
      index++;
      document.getElementById(
        "counter"
      ).innerText = `${index} / ${contentNews.length}`;
    }

    // Reset reaction buttons when changing cards
    resetReactionButtons();

    card.style.opacity = 1;
    card.style.transform = "translateX(0)";
  }, 200);
}

// --- Creates portal for smart tooltip ---
function createPortalTooltip(type) {
  const data = tooltipData[type];
  if (!data) return null;

  const tooltip = document.createElement("div");
  tooltip.className = "portal-tooltip";
  tooltip.innerHTML = `
    <div class="score-tooltip-title">
      <i class="ph ${data.icon}"></i> ${data.title}
    </div>
    ${data.content}
    <div class="tooltip-scale">
      <span>${data.scaleStart}</span>
      <span>${data.scaleEnd}</span>
    </div>
  `;

  return tooltip;
}

// --- Calculated positioning for tooltip
function positionTooltip(tooltip, triggerRect) {
  const tooltipWidth = 240;
  const tooltipHeight = tooltip.offsetHeight || 120; // Estimate if not rendered yet
  const margin = 10;
  const arrowSize = 6;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top, left;
  let arrowPosition = "bottom"; // Default: tooltip above, arrow pointing down

  // Try to position above the trigger
  top = triggerRect.top - tooltipHeight - arrowSize - 4;
  left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;

  // If tooltip would go above viewport, position below
  if (top < margin) {
    top = triggerRect.bottom + arrowSize + 4;
    arrowPosition = "top";
  }

  // If tooltip would go below viewport, try above again or adjust
  if (top + tooltipHeight > viewportHeight - margin) {
    top = triggerRect.top - tooltipHeight - arrowSize - 4;
    arrowPosition = "bottom";
  }

  // Horizontal boundary checks
  if (left < margin) {
    left = margin;
  }
  if (left + tooltipWidth > viewportWidth - margin) {
    left = viewportWidth - tooltipWidth - margin;
  }

  // Remove all arrow classes and add the correct one
  tooltip.classList.remove(
    "arrow-top",
    "arrow-bottom",
    "arrow-left",
    "arrow-right"
  );
  tooltip.classList.add(`arrow-${arrowPosition}`);

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

// --- Tooltip show helper ---
function showPortalTooltip(triggerElement, type) {
  // Clear any pending hide
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  // Remove existing tooltip
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }

  const tooltip = createPortalTooltip(type);
  if (!tooltip) return;

  tooltipPortal.appendChild(tooltip);
  activeTooltip = tooltip;

  // Position after adding to DOM so we can measure
  const triggerRect = triggerElement.getBoundingClientRect();

  // Need a frame to measure properly
  requestAnimationFrame(() => {
    positionTooltip(tooltip, triggerRect);
    tooltip.classList.add("visible");
  });
}

// --- Tooltip hide helper ---
function hidePortalTooltip() {
  if (!activeTooltip) return;

  activeTooltip.classList.remove("visible");

  const tooltipToRemove = activeTooltip;
  hideTimeout = setTimeout(() => {
    tooltipToRemove.remove();
    if (activeTooltip === tooltipToRemove) {
      activeTooltip = null;
    }
  }, 200);
}

// --- Initialize tooltip listeners ---
function initTooltips() {
  // Score info buttons - determine type by checking parent classes
  document
    .querySelectorAll(".score-info-btn, .overlay-score-info-btn")
    .forEach((btn) => {
      const parent = btn.closest(".score-badge, .overlay-score-badge");
      let type = "quality"; // default

      if (parent) {
        // Check if it's a bias or quality badge
        const icon = parent.querySelector(
          ".score-badge-icon, .overlay-score-icon"
        );
        if (icon && icon.classList.contains("bias")) {
          type = "bias";
        }
      }

      btn.addEventListener("mouseenter", (e) => {
        showPortalTooltip(btn, type);
      });

      btn.addEventListener("mouseleave", () => {
        hidePortalTooltip();
      });

      btn.addEventListener("focus", (e) => {
        showPortalTooltip(btn, type);
      });

      btn.addEventListener("blur", () => {
        hidePortalTooltip();
      });

      // Touch support
      btn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        if (activeTooltip) {
          hidePortalTooltip();
        } else {
          showPortalTooltip(btn, type);
        }
      });
    });

  // Hide tooltip when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".score-info-btn, .overlay-score-info-btn")) {
      hidePortalTooltip();
    }
  });

  // Hide on scroll
  document.addEventListener("scroll", hidePortalTooltip, true);

  // Reposition on window resize
  window.addEventListener("resize", () => {
    if (activeTooltip) {
      hidePortalTooltip();
    }
  });
}

// ((((((((((((--- Popup helper functions ---)))))))))))))))

function showFeedbackPopup() {
  const popup = document.getElementById("feedback-popup");
  popup.style.display = "flex";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      popup.classList.add("active");
    });
  });
  document.body.style.overflow = "hidden";
}

function hideFeedbackPopup() {
  const popup = document.getElementById("feedback-popup");
  popup.classList.remove("active");
  setTimeout(() => {
    popup.style.display = "none";
    document.body.style.overflow = "";
    // Reset form
    document.getElementById("feedback-details").value = "";
    document.getElementById("feedback-char-current").textContent = "0";
    document.querySelector(
      'input[name="feedback-type"][value="inaccurate"]'
    ).checked = true;
  }, 300);
}

function showPasswordResetPopup() {
  const popup = document.getElementById("password-reset-popup");
  popup.style.display = "flex";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      popup.classList.add("active");
    });
  });
  document.body.style.overflow = "hidden";
}

function hidePasswordResetPopup() {
  const popup = document.getElementById("password-reset-popup");
  popup.classList.remove("active");
  setTimeout(() => {
    popup.style.display = "none";
    document.body.style.overflow = "";
  }, 300);
}

function showDeleteAccountPopup() {
  const popup = document.getElementById("delete-account-popup");
  popup.style.display = "flex";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      popup.classList.add("active");
    });
  });
  document.body.style.overflow = "hidden";
}

function hideDeleteAccountPopup() {
  const popup = document.getElementById("delete-account-popup");
  popup.classList.remove("active");
  setTimeout(() => {
    popup.style.display = "none";
    document.body.style.overflow = "";
  }, 300);
}

// ((((((((((((--- END  ---)))))))))))))))

// --- Helper function to update all saved button states ---
function updateAllSaveBtns(isActive) {
  saveBtn.forEach((btn) => {
    if (isActive) {
      btn.classList.add("active");
      btn.innerHTML = '<i class="ph-fill ph-star"></i>';
    } else {
      btn.classList.remove("active");
      btn.innerHTML = '<i class="ph ph-star"></i>';
    }
  });
}

// --- Set toggle state from server data ---
function setLanguageToggle(lang) {
  currentLang = lang;
  if (lang === "nl") {
    langToggle.classList.add("nl");
    langOptions[0].classList.remove("active");
    langOptions[1].classList.add("active");
  } else {
    langToggle.classList.remove("nl");
    langOptions[0].classList.add("active");
    langOptions[1].classList.remove("active");
  }
}

// --- Change main content lang toggle ---
function setLanguageToggleContent(lang) {
  if (lang === "nl") {
    langContentToggle.classList.add("nl");
    langContentOptions[0].classList.remove("active");
    langContentOptions[1].classList.add("active");
  } else {
    langContentToggle.classList.remove("nl");
    langContentOptions[0].classList.add("active");
    langContentOptions[1].classList.remove("active");
  }
}
// ================================================
// BILLING TAB FUNCTIONALITY
// ================================================

// Initialize billing when navigating to billing tab

// Update the billing UI based on user data
async function updateBillingUI() {
  let userData;

  try {
    const response = await fetch("/api/user-data", {
      method: "GET",
      credentials: "include",
    });

    if (response.ok) {
      userData = await response.json();
    } else if (response.status === 403) {
      const responseRefresh = await fetch("/api/refresh", {
        method: "GET",
        credentials: "include",
      });

      if (responseRefresh.status === 401 || responseRefresh.status === 403) {
        showToast("info", "Session Expired", "Please log in again.");
        setTimeout(() => {
          window.location.href = "/log-in";
        }, 1000);
        return;
      }

      const response02 = await fetch("/api/user-data", {
        method: "GET",
        credentials: "include",
      });

      if (!response02.ok) {
        showToast("error", "Error", "Failed to load billing information.");
        return;
      }
      userData = await response02.json();
    } else {
      showToast("error", "Error", "Failed to load billing information.");
      return;
    }
  } catch (e) {
    console.error("Billing fetch error:", e);
    showToast("error", "Error", "Failed to load billing information.");
    return;
  }

  // Guard: Make sure we have userData
  if (!userData) {
    console.error("No user data received");
    return;
  }

  data = userData; // Sync the info globally

  const plan = userData.secretInfo || "free";
  const subscription = userData.subscription;
  const canStartTrial = userData.canStartTrial;

  // Elements
  const planNameEl = document.getElementById("billing-plan-name");
  const planBadgeEl = document.getElementById("billing-plan-badge");
  const statusTextEl = document.getElementById("billing-status-text");
  const trialBannerEl = document.getElementById("trial-banner");
  const trialMessageEl = document.getElementById("trial-message");
  const trialDaysEl = document.getElementById("trial-days-left");
  const countdownDaysEl = document.getElementById("countdown-days");
  const subscriptionDetailsEl = document.getElementById("subscription-details");
  const nextBillingDateEl = document.getElementById("next-billing-date");
  const billingAmountEl = document.getElementById("billing-amount");
  const cancellationNoticeEl = document.getElementById("cancellation-notice");
  const cancellationDateEl = document.getElementById("cancellation-date");
  const upgradeSectionEl = document.getElementById("upgrade-section");
  const manageSectionEl = document.getElementById("manage-section");
  const cancelSectionEl = document.getElementById("cancel-section");
  const trialCtaEl = document.getElementById("trial-cta");

  // Guard: Check essential elements exist
  if (!planNameEl || !planBadgeEl || !statusTextEl) {
    console.error("Essential billing elements not found in DOM");
    return;
  }

  // Reset visibility
  trialBannerEl?.classList.add("hidden");
  subscriptionDetailsEl?.classList.add("hidden");
  cancellationNoticeEl?.classList.add("hidden");
  upgradeSectionEl?.classList.remove("hidden");
  manageSectionEl?.classList.add("hidden");
  cancelSectionEl?.classList.add("hidden");
  trialCtaEl?.classList.add("hidden");

  // Determine subscription state
  if (plan === "free" || !subscription) {
    // Free user
    planNameEl.textContent = "Free";
    planNameEl.classList.remove("premium");
    planBadgeEl.className = "plan-badge inactive";
    statusTextEl.textContent = "No active subscription";

    if (canStartTrial) {
      trialCtaEl?.classList.remove("hidden");
    }

    if (billingAmountEl) {
      billingAmountEl.textContent = "—";
    }
    return; // Exit here for free users
  } else if (subscription.status === "trialing") {
    // Trial active
    planNameEl.textContent = "Everyday";
    planNameEl.classList.add("premium");
    planBadgeEl.className = "plan-badge trialing";
    statusTextEl.textContent = "Trial Active";

    trialBannerEl?.classList.remove("hidden");

    if (subscription.trialEnd) {
      const trialEndDate = new Date(subscription.trialEnd);
      const now = new Date();
      const daysLeft = Math.max(
        0,
        Math.ceil((trialEndDate - now) / (1000 * 60 * 60 * 24))
      );

      if (trialDaysEl) trialDaysEl.textContent = daysLeft;
      if (countdownDaysEl) countdownDaysEl.textContent = daysLeft;
      if (trialMessageEl) {
        trialMessageEl.innerHTML = `Your trial ends in <strong>${daysLeft}</strong> day${
          daysLeft !== 1 ? "s" : ""
        }`;
      }
    }

    upgradeSectionEl?.classList.add("hidden");
    manageSectionEl?.classList.remove("hidden");
    cancelSectionEl?.classList.remove("hidden");

    subscriptionDetailsEl?.classList.remove("hidden");
    if (nextBillingDateEl && subscription.currentPeriodEnd) {
      nextBillingDateEl.textContent = formatDate(subscription.currentPeriodEnd);
    }
  } else if (subscription.status === "active") {
    // Active subscription
    planNameEl.textContent = "Everyday";
    planNameEl.classList.add("premium");
    planBadgeEl.className = "plan-badge active";
    statusTextEl.textContent = "Active";

    subscriptionDetailsEl?.classList.remove("hidden");
    if (nextBillingDateEl && subscription.currentPeriodEnd) {
      nextBillingDateEl.textContent = formatDate(subscription.currentPeriodEnd);
    }

    upgradeSectionEl?.classList.add("hidden");
    manageSectionEl?.classList.remove("hidden");

    if (subscription.cancelAtPeriodEnd) {
      planBadgeEl.className = "plan-badge canceled";
      statusTextEl.textContent = "Canceled";

      cancellationNoticeEl?.classList.remove("hidden");
      if (cancellationDateEl && subscription.currentPeriodEnd) {
        cancellationDateEl.textContent = formatDate(
          subscription.currentPeriodEnd
        );
      }
      cancelSectionEl?.classList.add("hidden");
    } else {
      cancelSectionEl?.classList.remove("hidden");
    }
  } else if (subscription.status === "past_due") {
    // Payment failed
    planNameEl.textContent = "Everyday";
    planNameEl.classList.add("premium");
    planBadgeEl.className = "plan-badge canceled";
    statusTextEl.textContent = "Payment Failed";

    manageSectionEl?.classList.remove("hidden");
    upgradeSectionEl?.classList.add("hidden");
  } else if (subscription.status === "canceled") {
    // Canceled subscription
    planNameEl.textContent = "Free";
    planNameEl.classList.remove("premium");
    planBadgeEl.className = "plan-badge inactive";
    statusTextEl.textContent = "Subscription ended";

    if (canStartTrial) {
      trialCtaEl?.classList.remove("hidden");
    }

    // Set billing amount for canceled users and RETURN
    if (billingAmountEl) {
      billingAmountEl.textContent = "—";
    }
    return;
  }

  if (billingAmountEl) {
    if (!subscription.priceId) {
      billingAmountEl.textContent = "Unavailable";
    } else if (subscription.priceId === "price_1SmSq74l4iN5og0MOr6Z4GZr") {
      billingAmountEl.textContent = "€5.00/month";
    } else if (subscription.priceId === "price_1SmSq74l4iN5og0MJPsDCGne") {
      billingAmountEl.textContent = "€50.00/year";
    } else {
      billingAmountEl.textContent = "Unavailable";
    }
  }
}

// Format date for display
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Create checkout session
async function createCheckoutSession(plan, withTrial = false) {
  const btn =
    plan === "everydayMonthly"
      ? document.getElementById("subscribe-monthly-btn")
      : document.getElementById("subscribe-yearly-btn");

  const originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Processing...';
  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ plan, withTrial }),
    });

    if (response.ok) {
      const refreshedData = await response.json();
      if (refreshedData.url) {
        window.location.href = refreshedData.url;
      }
    } else if (response.status === 401) {
      showToast(
        "error",
        "Verify Email",
        "Please verify your email before subscribing."
      );
      btn.disabled = false;
      btn.innerHTML = originalContent;
    } else if (response.status === 399) {
      showToast(
        "info",
        "Already Subscribed",
        "You already have an active subscription."
      );
      btn.disabled = false;
      btn.innerHTML = originalContent;
    } else if (response.status === 403) {
      window.loca;
    } else {
      throw new Error("Failed to create checkout session");
    }
  } catch (error) {
    console.error("Checkout error:", error);
    showToast(
      "error",
      "Error",
      "Failed to start checkout. Something went wrong..."
    );
  } finally {
    btn.innerHTML = originalContent;
    btn.disabled = false;
  }
}

// Open Stripe billing portal
async function openBillingPortal() {
  try {
    const response = await fetch("/api/create-portal-session", {
      method: "POST",
      credentials: "include",
    });

    if (response.ok) {
      const refreshedData = await response.json();
      if (refreshedData.url) {
        window.location.href = refreshedData.url;
      }
    } else if (response.status === 404) {
      showToast("error", "No Subscription", "No active subscription found.");
    } else if (response.status === 403) {
      showToast("info", "Session Expired", "Please log in again.");
      setTimeout(() => {
        window.location.href = "/log-in";
      }, 1000);
    } else {
      throw new Error("Failed to open billing portal");
    }
  } catch (error) {
    console.error("Portal error:", error);
    showToast("error", "Error", "Failed to open billing portal.");
  }
}

// Cancel subscription
async function cancelSubscription() {
  const btn = document.getElementById("confirm-cancel-subscription");
  const originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Canceling...';

  try {
    const response = await fetch("/api/cancel-subscription", {
      method: "POST",
      credentials: "include",
    });

    if (response.ok) {
      hideCancelSubscriptionPopup();
      showToast(
        "success",
        "Subscription Canceled",
        "Your will not be charged again, unless you resubscribe."
      );

      // Update local data and refresh UI
      if (data.subscription) {
        data.subscription.cancelAtPeriodEnd = true;
      }
      await updateBillingUI();
    } else if (response.status === 404) {
      hideCancelSubscriptionPopup();
      showToast("error", "Error", "No active subscription found to cancel.");
    } else if (response.status === 202) {
      hideCancelSubscriptionPopup();
      showToast(
        "success",
        "Subscription Canceled",
        "Your free trial has been canceled, continue using Header for free."
      );

      // Update local data and refresh UI
    } else if (response.status === 403) {
      showToast("info", "Session Expired", "Please log in again.");
      setTimeout(() => {
        window.location.href = "/log-in";
      }, 1000);
    } else {
      throw new Error("Failed to cancel subscription");
    }
  } catch (error) {
    console.error("Cancel error:", error);
    showToast(
      "error",
      "Error",
      "Failed to cancel subscription. Please try again."
    );
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalContent;
  }
}

// Reactivate subscription
async function reactivateSubscription() {
  const btn = document.getElementById("reactivate-btn");
  const originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';

  try {
    const response = await fetch("/api/reactivate-subscription", {
      method: "POST",
      credentials: "include",
    });

    if (response.ok) {
      showToast(
        "success",
        "Subscription Reactivated",
        "Your subscription has been reactivated."
      );

      // Update local data and refresh UI
      if (data.subscription) {
        data.subscription.cancelAtPeriodEnd = false;
      }
      await updateBillingUI();
    } else if (response.status === 404) {
      showToast("error", "Error", "No subscription found to reactivate.");
    } else if (response.status === 403) {
      showToast("info", "Session Expired", "Please log in again.");
      setTimeout(() => {
        window.location.href = "/log-in";
      }, 1000);
    } else {
      throw new Error("Failed to reactivate subscription");
    }
  } catch (error) {
    console.error("Reactivate error:", error);
    showToast("error", "Error", "Failed to reactivate subscription.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalContent;
  }
}

// Cancel subscription popup helpers
function showCancelSubscriptionPopup() {
  const popup = document.getElementById("cancel-subscription-popup");

  // Update the date in popup
  if (data.subscription && data.subscription.currentPeriodEnd) {
    document.getElementById("cancel-access-date").textContent = formatDate(
      data.subscription.currentPeriodEnd
    );
  }

  popup.style.display = "flex";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      popup.classList.add("active");
    });
  });
  document.body.style.overflow = "hidden";
}

function hideCancelSubscriptionPopup() {
  const popup = document.getElementById("cancel-subscription-popup");
  popup.classList.remove("active");
  setTimeout(() => {
    popup.style.display = "none";
    document.body.style.overflow = "";
  }, 300);
}

// Initialize billing event listeners
function initBillingEventListeners() {
  // Subscribe buttons
  document
    .getElementById("subscribe-monthly-btn")
    ?.addEventListener("click", () => {
      const withTrial =
        document.getElementById("trial-checkbox")?.checked ?? false;
      createCheckoutSession("everydayMonthly", withTrial);
    });

  document
    .getElementById("subscribe-yearly-btn")
    ?.addEventListener("click", () => {
      const withTrial =
        document.getElementById("trial-checkbox")?.checked ?? false;
      createCheckoutSession("everydayYearly", withTrial);
    });

  // Management buttons (all open Stripe portal)
  document
    .getElementById("manage-payment-btn")
    ?.addEventListener("click", openBillingPortal);
  document
    .getElementById("billing-history-btn")
    ?.addEventListener("click", openBillingPortal);
  document
    .getElementById("change-plan-btn")
    ?.addEventListener("click", openBillingPortal);

  // Cancel subscription
  document
    .getElementById("cancel-subscription-btn")
    ?.addEventListener("click", showCancelSubscriptionPopup);
  document
    .getElementById("cancel-sub-popup-close")
    ?.addEventListener("click", hideCancelSubscriptionPopup);
  document
    .getElementById("confirm-cancel-subscription")
    ?.addEventListener("click", cancelSubscription);

  // Reactivate subscription
  document
    .getElementById("reactivate-btn")
    ?.addEventListener("click", reactivateSubscription);

  // Close popup on background click
  document
    .getElementById("cancel-subscription-popup")
    ?.addEventListener("click", (e) => {
      if (e.target.id === "cancel-subscription-popup") {
        hideCancelSubscriptionPopup();
      }
    });
}

// Check for payment success/canceled from URL
function checkPaymentStatus() {
  const urlParams = new URLSearchParams(window.location.search);
  const paymentStatus = urlParams.get("payment");

  if (paymentStatus === "success") {
    setTimeout(() => {
      showToast(
        "success",
        "Welcome to Everyday!",
        "Your subscription is now active. Enjoy all the premium features."
      );
    }, 500);
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (paymentStatus === "canceled") {
    setTimeout(() => {
      showToast(
        "info",
        "Checkout Canceled",
        "Your checkout was canceled. No charges were made."
      );
    }, 500);
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// --- Functions to show welcome overlay to new users ---

function showWelcomeBanner(userName) {
  const banner = document.getElementById("welcome-banner");
  const greeting = document.getElementById("welcome-user-greeting");

  greeting.textContent = `Great to have you here, ${userName}.`;

  banner.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  // Initialize the button handler
  document
    .getElementById("welcome-got-it-btn")
    .addEventListener("click", dismissWelcomeBanner);
}

async function dismissWelcomeBanner() {
  const btn = document.getElementById("welcome-got-it-btn");
  const banner = document.getElementById("welcome-banner");

  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Loading...';

  try {
    const response = await fetch("/api/refresh/update-user-hints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ welcome: false }),
    });

    if (response.ok) {
      banner.classList.add("hidden");
      document.body.style.overflow = "";
    } else if (response.status === 403) {
      showToast("info", "Session Expired", "Please log in again.");
      setTimeout(() => {
        window.location.href = "/log-in";
      }, 1000);
    } else {
      throw new Error();
    }
  } catch {
    banner.classList.add("hidden");
    document.body.style.overflow = "";
  }
}

// ---------------------------------------------------------- FUNCTIONS END ---------------------------------------------

let currentArticleId = null;
let currentArticleLink = null;
let currentArticleObj = null;
let currentLang = null;
let pendingLang = null;
let data = null;
let billingData = null;

// --- Language Toggle ---
const langContentToggle = document.getElementById("languageContentToggle"); // For main content lang
const langContentOptions = langContentToggle.querySelectorAll(
  ".lang-option-content"
);

const langToggle = document.getElementById("languageToggle"); // For settings
const langOptions = langToggle.querySelectorAll(".lang-option");
const langActions = document.getElementById("languageActions");
const langActionsText = document.getElementById("languageActionsText");
const cancelLangBtn = document.getElementById("cancelLangBtn");
const confirmLangBtn = document.getElementById("confirmLangBtn");

// Handle overlay content change
langContentOptions.forEach((opt) => {
  opt.addEventListener("click", () => {
    const lang = opt.dataset.lang;

    if (lang === "nl") {
      setLanguageToggleContent("nl");
      document.getElementById("overlay-full-content").innerText =
        currentArticleObj.contentNL || currentArticleObj.content;
      if (!currentArticleObj.contentNL) {
        setLanguageToggle("en");
      }
      return;
    } else {
      setLanguageToggleContent("en");
      document.getElementById("overlay-full-content").innerText =
        currentArticleObj.content;
    }
  });
});

// Handle toggle click
langOptions.forEach((opt) => {
  opt.addEventListener("click", () => {
    const lang = opt.dataset.lang;

    if (lang === currentLang) {
      setLanguageToggle(currentLang);
      langActions.classList.add("hidden");
      pendingLang = null;
      return;
    }

    pendingLang = lang;

    // Update toggle visual
    if (lang === "nl") {
      langToggle.classList.add("nl");
      langOptions[0].classList.remove("active");
      langOptions[1].classList.add("active");
      langActionsText.textContent = "Switch to Dutch news";
    } else {
      langToggle.classList.remove("nl");
      langOptions[0].classList.add("active");
      langOptions[1].classList.remove("active");
      langActionsText.textContent = "Switch to English news";
    }

    langActions.classList.remove("hidden");
  });
});

// Cancel
cancelLangBtn.addEventListener("click", () => {
  pendingLang = null;
  langActions.classList.add("hidden");
  setLanguageToggle(currentLang);
});

// Confirm
confirmLangBtn.addEventListener("click", async () => {
  if (!pendingLang) return;

  confirmLangBtn.disabled = true;
  confirmLangBtn.textContent = "Switching...";

  try {
    const res = await fetch("/api/refresh/update-language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ language: pendingLang }),
    });

    if (res.ok) {
      showToast("success", "Region Updated", "Reloading your feed...");
      localStorage.clear();
      setTimeout(() => location.reload(), 1000);
    } else if (res.status === 401) {
      setLanguageToggle(currentLang);
      langActions.classList.add("hidden");
      showToast("error", "Verify Email", "Please verify your email first.");
    } else if (res.status === 400) {
      setLanguageToggle(currentLang);
      langActions.classList.add("hidden");
      showToast(
        "info",
        "Region Not Changed ",
        "This is already your current region."
      );
    } else if (res.status === 403) {
      showToast("info", "Session Expired", "Please log in again.");
      setTimeout(() => {
        window.location.href = "/log-in";
      }, 1000);
    } else if (res.status === 503) {
      setLanguageToggle(currentLang);
      langActions.classList.add("hidden");
      showToast(
        "error",
        "Region Not Changed",
        "News region may only be changed once per hour. Please try again later."
      );
    } else if (res.status === 409) {
      setLanguageToggle(currentLang);
      langActions.classList.add("hidden");
      showToast(
        "warning",
        "Unable to Change Region",
        "This feature is only available in paid plans."
      );
    } else {
      throw new Error();
    }
  } catch {
    setLanguageToggle(currentLang);
    langActions.classList.add("hidden");
    showToast("error", "Error", "Failed to update. Try again.");
  } finally {
    confirmLangBtn.disabled = false;
    confirmLangBtn.textContent = "Switch Region";
    pendingLang = null;
  }
});

// --- Name Edit Logic ---
const changeNameBtn = document.getElementById("changeNameBtn");
const nameDisplay = document.getElementById("nameDisplay");
const nameEdit = document.getElementById("nameEdit");
const nameInput = document.getElementById("nameInput");
const cancelNameBtn = document.getElementById("cancelNameBtn");
const saveNameBtn = document.getElementById("saveNameBtn");
const currentName = document.getElementById("currentNameDisplay");

// Open edit mode
changeNameBtn.addEventListener("click", () => {
  nameDisplay.classList.add("hidden");
  currentName.style.display = "none";
  nameEdit.classList.remove("hidden");
  nameInput.value = window.currentUserName || "";
  nameInput.focus();
  nameInput.select();
});

// Cancel edit
cancelNameBtn.addEventListener("click", () => {
  nameEdit.classList.add("hidden");
  nameDisplay.classList.remove("hidden");
  currentName.style.display = "";
  nameInput.value = window.currentUserName || "";
});

// Handle Enter key to save, Escape to cancel
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveNameBtn.click();
  } else if (e.key === "Escape") {
    cancelNameBtn.click();
  }
});

// Save name
saveNameBtn.addEventListener("click", async () => {
  const newName = nameInput.value.trim();

  // Validation
  if (!newName) {
    showToast(
      "warning",
      "Name Required",
      "Please enter a valid first name (singe word, letters, hyphens, apostrophes only)."
    );
    nameInput.focus();
    return;
  }

  if (newName.length < 2) {
    showToast(
      "warning",
      "Name Too Short",
      "Name must be at least 2 characters."
    );
    nameInput.focus();
    return;
  }

  if (newName.length > 20) {
    showToast(
      "warning",
      "Name Too Long",
      "Name must be no longer than 20 characters."
    );
    nameInput.focus();
    return;
  }

  if (newName === window.currentUserName) {
    // No change, just close
    nameEdit.classList.add("hidden");
    nameDisplay.classList.remove("hidden");
    currentName.style.display = "";
    return;
  }
  // Disable buttons and show loading
  saveNameBtn.disabled = true;
  saveNameBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
  cancelNameBtn.disabled = true;
  nameInput.disabled = true;

  try {
    const response = await fetch("/api/refresh/update-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: newName }),
    });

    if (response.ok) {
      // Update stored name
      window.currentUserName = newName;
      currentName.style.display = "";
      // Update display
      document.getElementById("currentNameDisplay").innerText = newName;

      // Close edit mode
      nameEdit.classList.add("hidden");
      nameDisplay.classList.remove("hidden");

      showToast(
        "success",
        "Name Updated",
        "Your name has been changed successfully."
      );
    } else if (response.status === 403) {
      showToast("info", "Session Expired", "Please log in again.");
      setTimeout(() => {
        window.location.href = "/log-in";
      }, 1000);
    } else if (response.status === 400) {
      showToast(
        "warning",
        "Invalid Name",
        "Please enter a valid first name (singe word, letters, hyphens, apostrophes only)."
      );
    } else if (response.status === 401) {
      // Close edit mode
      nameEdit.classList.add("hidden");
      nameDisplay.classList.remove("hidden");
      currentName.style.display = "";
      showToast(
        "error",
        "Failed to Change Name",
        "Verify your account first before performing this action."
      );
    } else {
      throw new Error("Failed to update");
    }
  } catch (error) {
    console.error("Name update error:", error);
    showToast(
      "error",
      "Update Failed",
      "Unable to update your name. Please try again."
    );
  } finally {
    // Re-enable buttons
    saveNameBtn.disabled = false;
    saveNameBtn.innerHTML = '<i class="ph ph-check"></i>';
    cancelNameBtn.disabled = false;
    nameInput.disabled = false;
  }
});

// --- Back to feed exit spinner screen button ---

document.getElementById("backBtn").addEventListener("click", () => {
  window.location.href = "/";
});

// --- Delete user account logic ---
const deleteBtn = document.getElementById("deleteAccountBtn");

deleteBtn.addEventListener("click", () => {
  showDeleteAccountPopup();
});

// --- Delete account and change password popup event listeners ---
document
  .getElementById("close-password-popup")
  .addEventListener("click", hidePasswordResetPopup);

document
  .getElementById("password-reset-popup")
  .addEventListener("click", (e) => {
    if (e.target.id === "password-reset-popup") {
      hidePasswordResetPopup();
    }
  });

document
  .getElementById("cancel-delete-popup")
  .addEventListener("click", hideDeleteAccountPopup);

document
  .getElementById("delete-account-popup")
  .addEventListener("click", (e) => {
    if (e.target.id === "delete-account-popup") {
      hideDeleteAccountPopup();
    }
  });

document
  .getElementById("confirm-delete-account")
  .addEventListener("click", async () => {
    const btn = document.getElementById("confirm-delete-account");
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Deleting...';

    try {
      const response = await fetch("/delete-account", {
        method: "DELETE",
        credentials: "include",
      });
      if (response.ok) {
        location.reload();
      } else if (response.status === 401) {
        hideDeleteAccountPopup();
        showToast(
          "error",
          "Failed to Delete Account",
          "Verify your account first before performing this action."
        );
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-trash"></i> Delete My Account';
      } else {
        hideDeleteAccountPopup();
        showToast(
          "error",
          "Unexpected Error",
          "Unable to delete account at this time."
        );
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-trash"></i> Delete My Account';
      }
    } catch (error) {
      hideDeleteAccountPopup();
      showToast(
        "error",
        "Connection Error",
        "Please check your connection and try again"
      );
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-trash"></i> Delete My Account';
    }
  });

// --- Verification banner logic ---
const verificationBanner = document.getElementById("verification-banner");
const resendVerificationBtn = document.getElementById(
  "resend-verification-btn"
);
const dismissBannerBtn = document.getElementById("dismiss-banner-btn");

// Resend verification email
resendVerificationBtn.addEventListener("click", async () => {
  const btn = resendVerificationBtn;
  const originalContent = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Sending...';

  try {
    const response = await fetch("/resend-verification", {
      method: "POST",
      credentials: "include",
    });

    if (response.ok) {
      btn.innerHTML = '<i class="ph ph-check"></i> Email Sent!';
      btn.style.background = "#10b981";

      setTimeout(() => {
        btn.innerHTML = originalContent;
        btn.style.background = "";
        btn.disabled = false;
      }, 60000);
    } else {
      throw new Error("Failed to resend");
    }
  } catch (error) {
    btn.innerHTML = '<i class="ph ph-warning"></i> Failed';
    btn.style.background = "#ef4444";
    showToast(
      "error",
      "Unexpected Error",
      "Something went wrong. Unable to process this request."
    );

    setTimeout(() => {
      btn.innerHTML = originalContent;
      btn.style.background = "";
      btn.disabled = false;
    }, 60000);
  }
});

dismissBannerBtn.addEventListener("click", () => {
  verificationBanner.classList.add("opacity");

  setTimeout(() => {
    void document.getElementById("top-bar-wrapper").offsetHeight;
    document.getElementById("verification-icon-wrapper").classList.add("hide");
    // document.getElementById("resend-verification-btn").style.height = "0px";
    // document.getElementById("resend-verification-btn").style.display = "none";
    document.getElementById("verification-title").classList.add("hide");
    void document.getElementById("top-bar-wrapper").offsetHeight;
    document.getElementById("verification-message").classList.add("hide");
    void document.getElementById("top-bar-wrapper").offsetHeight;
    document.getElementById("verification-actions").classList.add("hide");
    void document.getElementById("top-bar-wrapper").offsetHeight;
    document.getElementById("top-bar-wrapper").classList.add("height");
  }, 500);
  setTimeout(() => {
    verificationBanner.style.display = "none";
  }, 1500);
});

// --- Change password button logic ---
const changePasswordBtn = document.getElementById("changePasswordBtn");
changePasswordBtn.addEventListener("click", async () => {
  const originalContent = changePasswordBtn.innerHTML;
  changePasswordBtn.classList.add("disabled");
  changePasswordBtn.disabled = true;
  changePasswordBtn.innerHTML =
    '<i class="ph ph-spinner-gap ph-spin"></i> Sending...';

  if (data.authProvider === "google") {
    showToast(
      "error",
      "Error",
      "Password change is not supported for Google accounts."
    );
    changePasswordBtn.innerHTML = originalContent;
    changePasswordBtn.classList.remove("disabled");
    changePasswordBtn.disabled = false;
    return;
  }

  if (!data.verified) {
    showToast(
      "error",
      "Password Change error",
      "Verify your account first before performing this action."
    );
    changePasswordBtn.innerHTML = originalContent;
    changePasswordBtn.classList.remove("disabled");
    changePasswordBtn.disabled = false;
    return;
  }
  try {
    const response = await fetch("/request-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("emailUserDisabled").value,
      }),
    });

    if (response.ok) {
      showPasswordResetPopup();
    } else if (response.status === 403) {
      showToast("info", "Session Expired", "Please log in again.");
      setTimeout(() => {
        window.location.href = "/log-in";
      }, 1000);
    } else {
      showToast("error", "Error", "We were unable to process this request.");
    }
  } catch {
    showToast(
      "error",
      "Connection Error",
      "Please check your internet connection and try again."
    );
  }
  changePasswordBtn.innerHTML = originalContent;
  changePasswordBtn.classList.remove("disabled");
  changePasswordBtn.disabled = false;
});

// --- Reaction buttons logic --- >>>>>>>>>>>>>>>>>>>>>>>> Needs modifications
const feedbackBtnElem = document.getElementById("feedbackBtn");
const saveBtn = document.querySelectorAll(".save-btn");

// --- Feedback button logic ---
feedbackBtnElem.addEventListener("click", () => {
  showFeedbackPopup();
});

// --- Feedback popup event listeners ---

document.querySelectorAll(".feedback-option").forEach((label) => {
  label.addEventListener("click", () => {
    const input = label.querySelector("input[type='radio']");
    if (input.value === "other") {
      document.getElementById("feedback-details").classList.add("required");
      document.getElementById("feedback-details").placeholder =
        "Please provide more details about the issue (required)...";
    } else {
      document.getElementById("feedback-details").classList.remove("required");
      document.getElementById("feedback-details").placeholder =
        "Please provide more details about the issue (optional)...";
    }
  });
});

document
  .getElementById("cancel-feedback-popup")
  .addEventListener("click", () => {
    hideFeedbackPopup();
    document.getElementById("feedback-details").classList.remove("required");
    document.getElementById("feedback-details").placeholder =
      "Please provide more details about the issue (optional)...";
  });

document.getElementById("feedback-popup").addEventListener("click", (e) => {
  if (e.target.id === "feedback-popup") {
    document.getElementById("feedback-details").classList.remove("required");
    document.getElementById("feedback-details").placeholder =
      "Please provide more details about the issue (optional)...";
    hideFeedbackPopup();
  }
});

// Character count for feedback textarea
document.getElementById("feedback-details").addEventListener("input", (e) => {
  const count = e.target.value.length;
  document.getElementById("feedback-char-current").textContent = count;
});

// Submit feedback handler
document
  .getElementById("submit-feedback")
  .addEventListener("click", async () => {
    const btn = document.getElementById("submit-feedback");
    const feedbackType = document.querySelector(
      'input[name="feedback-type"]:checked'
    ).value;
    const feedbackDetails = document.getElementById("feedback-details").value;

    if (feedbackType === "other" && !feedbackDetails) {
      document.getElementById("feedback-details").classList.add("required");
      document.getElementById("feedback-details").placeholder =
        "Please provide more details about the issue (required)...";
      return;
    } else {
      document.getElementById("feedback-details").classList.remove("required");
      document.getElementById("feedback-details").placeholder =
        "Please provide more details about the issue (optional)...";
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Submitting...';

    try {
      const response = await fetch("/api/refresh/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          articleId: currentArticleId,
          articleLink: currentArticleLink,
          type: feedbackType,
          details: feedbackDetails,
          email: document.getElementById("emailUserDisabled").value,
        }),
      });

      if (response.ok) {
        hideFeedbackPopup();

        setTimeout(() => {
          showToast(
            "success",
            "Report Submitted",
            "Thank you for helping us improve content quality."
          );
        }, 1000);
      } else if (response.status === 403) {
        showToast("info", "Session Expired", "Please log in again.");
        setTimeout(() => {
          window.location.href = "/log-in";
        }, 1000);
      } else if (response.status === 429) {
        hideFeedbackPopup();
        showToast(
          "warning",
          "Too Many Reports",
          "Please wait before submitting another report."
        );
      } else {
        throw new Error("Failed to submit");
      }
    } catch (error) {
      showToast(
        "error",
        "Submission Failed",
        "Unable to submit your report. Please try again."
      );
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-paper-plane-tilt"></i> Submit Report';
    }
  });

// --- Save button logic ---
saveBtn.forEach((btn) => {
  btn.addEventListener("click", async () => {
    let response;
    const isCurrentlyActive = btn.classList.contains("active");

    try {
      if (!isCurrentlyActive) {
        // Adding to favorites
        updateAllSaveBtns(!isCurrentlyActive);
        response = await fetch("/api/refresh/save-article", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artId: currentArticleId,
            email: document.getElementById("emailUserDisabled").value,
            action: 1,
          }),
        });

        if (response.status === 200) {
          localStorage.setItem(currentArticleId, true);
          return;
        } else if (response.status === 409) {
          updateAllSaveBtns(!isCurrentlyActive);
          localStorage.setItem(currentArticleId, true);
          showToast(
            "warning",
            "Already Saved",
            'This article is already in your saved list, open the sidebar and head over to "Saved" to view it.'
          );
        } else if (response.status === 403) {
          showToast("info", "Session Expired", "Please log in again.");
          setTimeout(() => {
            window.location.href = "/log-in";
          }, 1000);
        } else if (response.status === 405) {
          showToast(
            "warning",
            "Unable To Save",
            "You have reached your saving limit. Please subscribe to a paid plan to be able to save more articles."
          );
        } else {
          showToast(
            "error",
            "Error",
            "Something went wrong. Please try again."
          );
        }
      } else {
        // Removing from favorites
        updateAllSaveBtns(!isCurrentlyActive);
        response = await fetch("/api/refresh/save-article", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artId: currentArticleId,
            email: document.getElementById("emailUserDisabled").value,
            action: 2,
          }),
        });

        if (response.status === 200) {
          localStorage.removeItem(currentArticleId);
          // If favorites view is open, remove the card from the grid
          if (isFavoritesOpen) {
            const card = document.querySelector(
              `.favorite-card[data-article-id="${currentArticleId}"]`
            );

            if (card) {
              card.classList.add("removing");

              // Find and remove from array
              const articleIndex = starredArt.savedArticles.findIndex(
                (a) => a._id === currentArticleId
              );
              if (articleIndex > -1) {
                starredArt.savedArticles.splice(articleIndex, 1);
              }

              // Convert trueIndex to number if it's a string
              trueIndex = parseInt(trueIndex, 10);

              setTimeout(() => {
                card.remove();

                const grid = document.getElementById("favorites-grid");
                if (grid.children.length === 0) {
                  document.getElementById("empty-favorites").style.display =
                    "flex";
                  closeArticleOverlay();
                  document.getElementById("favorites-grid").style.display =
                    "none";
                } else {
                  // Adjust trueIndex if needed
                  document.getElementById("favorites-grid").style.display = "";
                  if (trueIndex >= starredArt.savedArticles.length) {
                    trueIndex = starredArt.savedArticles.length - 1;
                  }

                  // Make sure trueIndex is valid
                  if (trueIndex < 0) {
                    trueIndex = 0;
                  }

                  // Get the new article
                  const newArticle = starredArt.savedArticles[trueIndex];

                  if (newArticle) {
                    // Update currentArticleId
                    currentArticleId = newArticle._id;
                    currentArticleLink = newArticle.link;
                    currentArticleObj = newArticle;

                    // Update overlay content
                    updateOverlayContentFavorites(trueIndex);

                    // In favorites, all articles are saved - show active state
                    updateAllSaveBtns(true);
                  } else {
                    // No more articles, close overlay
                    closeArticleOverlay();
                  }
                }
              }, 300);
            }
          }

          return;
        } else if (response.status === 403) {
          showToast("info", "Session Expired", "Please log in again.");
          setTimeout(() => {
            window.location.href = "/log-in";
          }, 1000);
        } else {
          showToast(
            "error",
            "Unexpected Error",
            "Something went wrong. Unable to process this request."
          );
        }
      }

      // Revert button state on error
      updateAllSaveBtns(isCurrentlyActive);
    } catch (error) {
      console.error("Save article error:", error);
      showToast(
        "error",
        "Connection Error",
        "Please check your internet connection and try again."
      );
      updateAllSaveBtns(isCurrentlyActive);
    }
  });
});

document.addEventListener("DOMContentLoaded", () => {
  try {
    setTimeout(() => {
      document.getElementById("welcome-msg").classList.add("hide");
      document.getElementById("secret-msg").classList.add("hide");
      setTimeout(() => {
        document.getElementById("verification-banner").classList.add("move");
        document.getElementById("welcome-msg").style.display = "none";
        document.getElementById("secret-msg").style.display = "none";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            void document.getElementById("top-bar-wrapper").offsetHeight;
            document.getElementById("top-bar-wrapper").classList.add("height");
          });
        });
      }, 1000);
    }, 3000);
  } catch {}
});

// --- Navigation logic (sidebar) & favorites tab loader ---
const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view-section");
const topBarWrapper = document.getElementById("top-bar-wrapper");
let starredArt;
let isFavoritesOpen = false;
let isFeedOpen = true;

navItems.forEach((item) => {
  item.addEventListener("click", async () => {
    navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");
    views.forEach((view) => (view.style.display = "none"));
    if (window.innerWidth <= 400) {
      sidebar.classList.remove("mobile-open");
      sidebar.classList.add("closed");
      document
        .querySelector(".main-content")
        .classList.remove("sidebar-active");
      closeSideElem.classList.remove("hide");
      openSideBtns.forEach((b) => b.classList.add("show"));
    }

    const targetId = item.getAttribute("data-target");
    const targetView = document.getElementById(targetId);

    if (targetView) {
      if (targetId === "view-feed") {
        document.getElementById("main-content").style.paddingTop = "20px";
        const grid = document.getElementById("favorites-grid");
        targetView.style.display = "flex";
        grid.style.gridTemplateColumns = "";
        grid.style.justifyContent = "";
        grid.style.marginTop = "";
        if (localStorage.getItem(currentArticleId)) {
          updateAllSaveBtns(true);
        } else {
          updateAllSaveBtns(false);
        }
        isFavoritesOpen = false;
        isFeedOpen = true;
      } else if (targetId === "view-favorites") {
        document.getElementById("main-content").style.paddingTop = "40px";
        isFavoritesOpen = true;
        isFeedOpen = false;
        const grid = document.getElementById("favorites-grid");
        const emptyState = document.getElementById("empty-favorites");
        grid.style.gridTemplateColumns = "1fr";
        grid.style.justifyContent = "center";
        grid.style.marginTop = "10vw";
        grid.innerHTML = `<div class="favorites-loading">
        <div class="favoriteLoaderDiv"><div class="loader-spinner"></div></div>
      <span>Loading your saved articles...</span>
    </div>`;
        emptyState.style.display = "none";
        document.getElementById("favorites-grid").style.display = "none";
        try {
          const response = await fetch("/api/refresh/load-stars", {
            method: "GET",
            credentials: "include",
          });

          if (response.ok) {
            document.getElementById("favorites-grid").style.display = "";
            const refreshedData = await response.json();
            starredArt = refreshedData;
            const articles = refreshedData.savedArticles;
            grid.innerHTML = "";
            grid.style.gridTemplateColumns = "";
            grid.style.justifyContent = "";
            grid.style.marginTop = "";

            articles.forEach((article, index) => {
              // Calculate time ago
              const parsedDate = new Date(
                article.date?.replace(" ", "T") || Date.now()
              );
              const diffHours = (Date.now() - parsedDate) / (1000 * 60 * 60);
              const timeAgo =
                diffHours > 24
                  ? `${Math.round(diffHours / 24)}d ago`
                  : `${Math.round(diffHours)}h ago`;

              const biasScoreValue = article.biasScoreAI
                ? `${article.biasScoreAI}/10`
                : "In paid plans";
              const qualityScoreValue = article.qualityScoreAI
                ? `${article.qualityScoreAI}/10`
                : "In paid plans";

              const card = document.createElement("div");
              card.className = "favorite-card";
              card.dataset.articleId = article._id;
              card.dataset.index = index;

              card.innerHTML = `
            <div class="fav-card-image" style="background-image: url('${
              article.imageLink || ""
            }')">
              <div class="fav-card-image-overlay"></div>
              <span class="fav-card-tag">${article.tag}</span>
              <button class="fav-card-remove" data-id="${
                article._id
              }" title="Remove from saved">
                <i class="ph ph-x"></i>
              </button>
            </div>
            <div class="fav-card-content">
              <h3 class="fav-card-title">${article.title}</h3>
              <p class="fav-card-summary">${
                article.bulletSummaryAI?.[0] ||
                article.longSummaryAI?.substring(0, 100)
              }</p>
              <div class="fav-card-footer">
                <div class="fav-card-meta">
                  <span class="fav-card-source">
                    <i class="ph ph-globe"></i>
                    ${article.publisher || ""}
                  </span>
                  <span class="fav-card-time">
                    <i class="ph ph-clock"></i>
                    ${timeAgo}
                  </span>
                </div>
                <div class="fav-card-scores">
                  <span class="fav-score bias" title="Bias Score">
                    <i class="ph ph-scales"></i>
                    ${biasScoreValue}
                  </span>
                  <span class="fav-score quality" title="Quality Score">
                    <i class="ph ph-seal-check"></i>
                    ${qualityScoreValue}
                  </span>
                </div>
              </div>
            </div>
          `;
              grid.appendChild(card);
            });
            initFavoriteCardHandlers();
          } else if (response.status === 404) {
            emptyState.style.display = "flex";
            grid.innerHTML = "";
            grid.style.gridTemplateColumns = "";
            grid.style.justifyContent = "";
            grid.style.marginTop = "";
          } else if (response.status === 403) {
            showToast("info", "Session Expired", "Please log in again.");
            setTimeout(() => {
              window.location.href = "/log-in";
            }, 1000);
          } else {
            showToast(
              "error",
              "Connection Error",
              "Unable to load your saved articles."
            );
            grid.innerHTML = "";
          }
        } catch (err) {
          console.error("Failed to load saved articles:", err);
          grid.innerHTML = "";
          showToast(
            "error",
            "Connection Error",
            "Please check your connection and try again."
          );
        }
        targetView.style.display = "block";
      } else if (targetId === "view-billing") {
        document.getElementById("main-content").style.paddingTop = "40px";
        isFavoritesOpen = false;
        isFeedOpen = false;
        targetView.style.display = "block";
        await updateBillingUI(); // Update billing data
      } else {
        document.getElementById("main-content").style.paddingTop = "40px";
        isFavoritesOpen = false;
        isFeedOpen = false;
        targetView.style.display = "block";
      }
    }
  });
});

const root = document.documentElement;
const closeSideElem = document.getElementById("closeSide");
const openSideBtns = document.querySelectorAll(".open-sidebar-btn");
const sidebar = document.getElementById("sidebar");

closeSideElem.addEventListener("click", () => {
  if (isFeedOpen) {
    document.getElementById("main-content").style.paddingTop = "13px";
  } else {
    document.getElementById("main-content").style.paddingTop = "20px";
  }
  document.getElementById("verification-banner").style.display = "none";
  try {
    document.getElementById("welcome-msg").style.transition = "none";
    document.getElementById("secret-msg").style.transition = "none";
    document.getElementById("welcome-msg").classList.add("hide");
    document.getElementById("secret-msg").classList.add("hide");
    openSideBtns.forEach((e) => {
      e.style.marginBottom = "5px";
    });
    document.getElementById("verification-banner").classList.add("move");
    document.getElementById("welcome-msg").style.display = "none";
    document.getElementById("secret-msg").style.display = "none";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Disable transition
        document.getElementById("top-bar-wrapper").style.transition = "none";

        // Make the changes
        document.getElementById("top-bar-wrapper").classList.add("height");
        document.getElementById("top-bar-wrapper").style.marginBottom = "-18px";

        // Force reflow so the change applies immediately
        void document.getElementById("top-bar-wrapper").offsetHeight;

        // Re-enable transition
        document.getElementById("top-bar-wrapper").style.transition = "";
        document.getElementById("welcome-msg").style.transition = "";
        document.getElementById("secret-msg").style.transition = "";
      });
    });
  } catch {}
  if (window.innerWidth < 400) {
    sidebar.classList.remove("mobile-open");
    sidebar.classList.add("closed");
    document.querySelector(".main-content").classList.remove("sidebar-active");
  } else {
    root.style.setProperty("--sidebar-width", "0px");
    sidebar.classList.add("closed");
  }
  closeSideElem.classList.add("hide");
  openSideBtns.forEach((btn) => btn.classList.add("show"));
});

// Logic for open sidebar button(s) which show when sidebar is closed
openSideBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (isFeedOpen) {
      document.getElementById("main-content").style.paddingTop = "20px";
    } else {
      document.getElementById("main-content").style.paddingTop = "40px";
    }
    if (window.innerWidth < 400) {
      sidebar.classList.add("mobile-open");
      sidebar.classList.remove("closed");
      document.querySelector(".main-content").classList.add("sidebar-active");
    } else {
      root.style.setProperty("--sidebar-width", "260px");
      sidebar.classList.remove("closed");
    }
    closeSideElem.classList.remove("hide");
    openSideBtns.forEach((b) => b.classList.remove("show"));
  });
});

document.addEventListener("keydown", (e) => {
  const overlayActive = document
    .getElementById("article-overlay")
    .classList.contains("active");

  if (e.key === "Escape" && overlayActive) {
    closeArticleOverlay();
    return;
  }

  if (e.key === "ArrowRight") {
    if (overlayActive) {
      navigateOverlay(1);
    } else {
      if (currentIndex < contentNews.length - 1) {
        currentIndex++;
      } else {
        currentIndex = 0;
      }
      renderCard(currentIndex);
      document.getElementById("news-body").scrollTop = 0;
    }
  }

  if (e.key === "ArrowLeft") {
    if (overlayActive) {
      navigateOverlay(-1);
    } else {
      if (currentIndex > 0) {
        currentIndex--;
      } else {
        currentIndex = contentNews.length - 1;
      }
      renderCard(currentIndex);
      document.getElementById("news-body").scrollTop = 0;
    }
  }
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(checkScreenSize, 100);
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  const logOutReq = await fetch("/api/refresh/logout", {
    credentials: "include",
  });
  if (logOutReq.status === 200) window.location.href = "/log-in";
});

// --- Article data global storage ---
let contentNews = [];

// --- Gets index from last stopped article saved in local storage ---
let currentIndex = parseInt(localStorage.getItem("currentIndex"), 10) || 0;

// --- Definitions for article overlay ---
const articleOverlay = document.getElementById("article-overlay");
const closeArticleBtn = document.getElementById("close-article-btn");
const readMoreLink = document.getElementById("news-link");
const overlayPrevBtn = document.getElementById("overlay-prev-btn");
const overlayNextBtn = document.getElementById("overlay-next-btn");
const overlayCounter = document.getElementById("overlay-counter");
const articleDocBody = document.getElementById("article-doc-body");
const resetViewBtnElem = document.getElementById("resetViewBtn");
const overlayPub = document.getElementById("article-doc-source-badge");

// --- Button to stop resetting view on new article ---
let resetEnabled = true;
resetViewBtnElem.addEventListener("click", () => {
  resetEnabled = !resetEnabled;

  if (resetEnabled) {
    resetViewBtnElem.classList.remove("active");
    resetViewBtnElem.innerHTML = '<i class="ph ph-arrow-line-up"></i>';
    resetViewBtnElem.title = "Click to keep scroll position when navigating";
  } else {
    resetViewBtnElem.classList.add("active");
    resetViewBtnElem.innerHTML = '<i class="ph ph-lock-simple"></i>';
    resetViewBtnElem.title = "Scroll position locked - click to unlock";
  }
});

document.getElementById("empty-offline").style.display = "flex";

readMoreLink.addEventListener("click", (e) => {
  e.preventDefault();
  openArticleOverlay(currentIndex);
});

closeArticleBtn.addEventListener("click", closeArticleOverlay);

overlayPrevBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  navigateOverlay(-1);
});

overlayNextBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  navigateOverlay(1);
});

articleOverlay.addEventListener("click", (e) => {
  if (e.target === articleOverlay) {
    closeArticleOverlay();
  }
});

document.getElementById("article-doc-body").style.transition =
  "opacity 0.15s ease, transform 0.15s ease";

const mainPub = document.getElementById("card-source");

document.getElementById("nextBtn").addEventListener("click", () => {
  if (currentIndex < contentNews.length - 1) {
    currentIndex++;
  } else {
    currentIndex = 0;
  }
  renderCard(currentIndex);
});

document.getElementById("prevBtn").addEventListener("click", () => {
  if (currentIndex > 0) {
    currentIndex--;
  } else {
    currentIndex = contentNews.length - 1;
  }
  renderCard(currentIndex);
});

// --- Portal tooltip setup ---
const tooltipPortal = document.getElementById("tooltip-portal");
let activeTooltip = null;
let hideTimeout = null;

const tooltipData = {
  bias: {
    icon: "ph-scales",
    title: "Bias Score",
    content:
      "Measures how opinionated or one-sided the article is. A low score indicates balanced, neutral reporting. A high score suggests strong opinions or missing counterpoints.",
    scaleStart: "1 = Very Neutral",
    scaleEnd: "10 = Very Biased",
  },
  quality: {
    icon: "ph-seal-check",
    title: "Quality Score",
    content:
      "Evaluates the overall journalistic quality: relevance, importance, depth of coverage, and how well the article explains the topic.",
    scaleStart: "1 = Low Quality",
    scaleEnd: "10 = Excellent",
  },
};

// --- Initialization ---
loadDashboard();
checkScreenSize();
initTooltips();
// Initialize billing
initBillingEventListeners();
checkPaymentStatus();
setInterval(checkSession, 480000);
