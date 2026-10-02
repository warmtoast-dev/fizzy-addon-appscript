/**
 * Fizzy for Gmail
 * ---------------
 * A small, unofficial Gmail add-on that turns the email you're reading into a
 * card on your Fizzy board (https://fizzy.do, the kanban tool from 37signals).
 *
 * How it works
 *   - Open an email  -> the side panel shows a form (title, board, tag).
 *   - "Create Fizzy Card" -> a card is created on the chosen board, with a
 *     link back to the original email in its description.
 *
 * Setup is done inside the add-on itself (Settings screen): paste your Fizzy
 * personal access token and you're done. Nothing needs to be edited in this
 * file. See README.md for the full install guide.
 *
 * Everything you save (token, account, board, tag) is stored in the
 * *user properties* of the Google account running the add-on, i.e. it is
 * private to you and is never written into this code.
 *
 * Not affiliated with 37signals. MIT licensed.
 */

/* ============================================================
   CONSTANTS
   ============================================================ */

var DEFAULT_BASE_URL = "https://app.fizzy.do";
var DEFAULT_TAG = "from_email";
var USER_AGENT = "Fizzy-Gmail-Addon/1.0";

var BOARD_CACHE_SECONDS = 300; // how long the board list is cached
var CREATED_CACHE_SECONDS = 21600; // 6h, the maximum CacheService allows
var MAX_PAGES = 20; // safety limit when following pagination

// Keys used in PropertiesService.getUserProperties()
var PROP = {
  TOKEN: "FIZZY_TOKEN",
  ACCOUNT: "FIZZY_ACCOUNT_SLUG",
  BASE_URL: "FIZZY_BASE_URL",
  TAG: "DEFAULT_TAG",
  BOARD: "DEFAULT_FIZZY_BOARD_ID",
};

/* ============================================================
   ENTRY POINTS (referenced from appsscript.json)
   ============================================================ */

/**
 * Homepage: shown when Fizzy is opened without an email selected.
 * If the add-on isn't configured yet, goes straight to the setup screen.
 */
function buildHomepage(e) {
  if (!isConfigured_()) {
    return [buildSettingsCard_()];
  }

  var section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        "<b>Get started by opening an email or conversation</b>",
      ),
    )
    .addWidget(settingsButton_());

  return [CardService.newCardBuilder().addSection(section).build()];
}

/**
 * Runs whenever an email is opened.
 * Any failure is turned into a friendly card instead of Gmail's generic error.
 */
function onGmailMessageOpen(e) {
  if (!e || !e.gmail || !e.gmail.messageId || !e.gmail.accessToken) {
    return buildHomepage(e);
  }

  if (!isConfigured_()) {
    return [buildSettingsCard_()];
  }

  try {
    return [buildComposeCard_(e)];
  } catch (error) {
    console.error("onGmailMessageOpen failed: " + error);
    return [buildErrorCard_(userMessage_(error))];
  }
}

/**
 * "Create Fizzy Card" button.
 */
function createFizzyCard(e) {
  try {
    var inputs = e.formInputs || {};

    var title =
      trim_(getFormValue_(inputs, "task_title")) || "New card from Gmail";
    var boardId = getFormValue_(inputs, "board_id");
    var tag = cleanTag_(getFormValue_(inputs, "tag"));

    if (!boardId) {
      return notify_("Please select a Fizzy board.");
    }

    var cfg = getConfig_();
    if (!cfg.token || !cfg.slug) {
      return notify_("Fizzy isn't set up yet. Open Settings first.");
    }

    if (!e.gmail || !e.gmail.messageId) {
      return notify_("Open an email first.");
    }

    // Remember the board for next time.
    PropertiesService.getUserProperties().setProperty(PROP.BOARD, boardId);

    var msg = getMessageInfo_(e);

    var description =
      '<p><a href="' +
      escapeHtml_(msg.permalink) +
      '">Open original email</a></p>';

    // Create the card.
    var response = fizzyRequest_(
      cfg,
      "post",
      "/" + cfg.slug + "/boards/" + encodeURIComponent(boardId) + "/cards.json",
      { card: { title: title, description: description } },
    );

    var cardNumber = extractCardNumber_(response);

    var cardUrl =
      cardNumber ?
        cfg.baseUrl + "/" + cfg.slug + "/cards/" + cardNumber
      : cfg.baseUrl + "/" + cfg.slug + "/boards/" + encodeURIComponent(boardId);

    // Tag it (best effort: the card already exists at this point).
    var tagFailed = false;
    if (tag && cardNumber) {
      tagFailed = !addTag_(cfg, cardNumber, tag);
    }

    // Remember that this email now has a card (so we can show a notice later).
    rememberCreatedCard_(msg.id, cardUrl);

    return buildSuccessCard_(
      cardUrl,
      tagFailed ? "The card was created, but the tag could not be added." : "",
    );
  } catch (error) {
    console.error("createFizzyCard failed: " + error);
    return notify_(userMessage_(error));
  }
}

/**
 * "Refresh boards" button: clears the cached board list and rebuilds the form.
 */
function refreshBoards(e) {
  clearBoardCache_();

  if (!e || !e.gmail || !e.gmail.messageId) {
    return notify_("Open an email first.");
  }

  try {
    return updateCard_(buildComposeCard_(e));
  } catch (error) {
    console.error("refreshBoards failed: " + error);
    return updateCard_(buildErrorCard_(userMessage_(error)));
  }
}

/**
 * "Settings" button.
 */
function openSettings(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildSettingsCard_()))
    .build();
}

/**
 * Settings screen "Save" button.
 * Validates the token against Fizzy before saving anything.
 */
function saveSettings(e) {
  try {
    var inputs = e.formInputs || {};
    var props = PropertiesService.getUserProperties();

    var token =
      trim_(getFormValue_(inputs, "token")) || getSetting_(PROP.TOKEN);
    var baseUrl = normalizeBaseUrl_(
      getFormValue_(inputs, "base_url") || DEFAULT_BASE_URL,
    );
    var tag = cleanTag_(getFormValue_(inputs, "default_tag"));
    var chosenAccount = normalizeSlug_(getFormValue_(inputs, "account"));

    if (!token) {
      return notify_("Please paste your Fizzy access token.");
    }

    // Validate the token (and discover the user's accounts).
    var accounts = fetchAccounts_(baseUrl, token);

    if (accounts.length === 0) {
      return notify_(
        "The token works, but no Fizzy accounts were found for it.",
      );
    }

    var account =
      accounts.filter(function (a) {
        return a.slug === chosenAccount;
      })[0] || accounts[0];

    clearBoardCache_();

    props.setProperty(PROP.TOKEN, token);
    props.setProperty(PROP.BASE_URL, baseUrl);
    props.setProperty(PROP.ACCOUNT, account.slug);
    props.setProperty(PROP.TAG, tag);

    // Board ids belong to an account, so forget the remembered one on change.
    if (account.slug !== chosenAccount) {
      props.deleteProperty(PROP.BOARD);
    }

    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("Saved"))
      .setNavigation(
        CardService.newNavigation().updateCard(
          buildSettingsCard_(
            "✅ <b>Saved.</b> Open any email to add it to Fizzy.",
          ),
        ),
      )
      .build();
  } catch (error) {
    console.error("saveSettings failed: " + error);
    return notify_(userMessage_(error));
  }
}

/* ============================================================
   CARDS
   ============================================================ */

/**
 * The main form shown when an email is open.
 */
function buildComposeCard_(e) {
  var cfg = getConfig_();
  var msg = getMessageInfo_(e);
  var boards = getBoards_(cfg);

  var section = CardService.newCardSection();

  // Already added? Say so (the user can still add it again if they want).
  var existingUrl = getCreatedCardUrl_(msg.id);
  if (existingUrl) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        "✅ This email is already in Fizzy.",
      ),
    );
    section.addWidget(
      CardService.newTextButton()
        .setText("View existing card")
        .setOpenLink(CardService.newOpenLink().setUrl(existingUrl)),
    );
  }

  // Title
  section.addWidget(
    CardService.newTextInput()
      .setFieldName("task_title")
      .setTitle("Title")
      .setValue(msg.subject || ""),
  );

  if (boards.length === 0) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        "No boards found in this Fizzy account. Create a board in Fizzy, " +
          "then tap <b>Refresh boards</b>.",
      ),
    );
  } else {
    var defaultBoardId = pickDefaultBoardId_(boards, getSetting_(PROP.BOARD));

    var boardSelector = CardService.newSelectionInput()
      .setFieldName("board_id")
      .setTitle("Board")
      .setType(CardService.SelectionInputType.DROPDOWN);

    if (!defaultBoardId) {
      boardSelector.addItem("Select a board…", "", true);
    }

    boards.forEach(function (board) {
      boardSelector.addItem(board.name, board.id, board.id === defaultBoardId);
    });

    section.addWidget(boardSelector);

    // Tag
    var defaultTag = getSetting_(PROP.TAG);
    if (defaultTag === null) {
      defaultTag = DEFAULT_TAG;
    }

    section.addWidget(
      CardService.newTextInput()
        .setFieldName("tag")
        .setTitle("Tag (optional)")
        .setValue(defaultTag),
    );

    // Create button (spinner prevents accidental double-clicks)
    section.addWidget(
      CardService.newTextButton()
        .setText("Create Fizzy Card")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName("createFizzyCard")
            .setLoadIndicator(CardService.LoadIndicator.SPINNER),
        ),
    );
  }

  section.addWidget(
    CardService.newButtonSet()
      .addButton(
        CardService.newTextButton()
          .setText("Refresh boards")
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName("refreshBoards")
              .setLoadIndicator(CardService.LoadIndicator.SPINNER),
          ),
      )
      .addButton(settingsTextButton_()),
  );

  return CardService.newCardBuilder().addSection(section).build();
}

/**
 * Settings / first-run setup screen.
 */
function buildSettingsCard_(message) {
  var cfg = getConfig_();
  var hasToken = !!cfg.token;

  var section = CardService.newCardSection();

  if (message) {
    section.addWidget(CardService.newTextParagraph().setText(message));
  }

  if (!hasToken) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        "<b>Connect Fizzy</b><br>" +
          "1. In Fizzy, open your profile → API → Personal access tokens.<br>" +
          "2. Generate a token with <b>Read + Write</b> permission.<br>" +
          "3. Paste it below and tap Save.",
      ),
    );
  }

  section.addWidget(
    CardService.newTextInput()
      .setFieldName("token")
      .setTitle("Fizzy access token")
      .setHint(
        hasToken ?
          "Saved (ends in " + cfg.token.slice(-4) + "). Leave blank to keep it."
        : "Paste your personal access token",
      ),
  );

  // Account dropdown (only once we have a token to look accounts up with).
  if (hasToken) {
    try {
      var accounts = fetchAccounts_(cfg.baseUrl, cfg.token);

      if (accounts.length > 0) {
        var accountSelector = CardService.newSelectionInput()
          .setFieldName("account")
          .setTitle("Fizzy account")
          .setType(CardService.SelectionInputType.DROPDOWN);

        accounts.forEach(function (account) {
          accountSelector.addItem(
            account.name + " (" + account.slug + ")",
            account.slug,
            account.slug === cfg.slug,
          );
        });

        section.addWidget(accountSelector);
      }
    } catch (error) {
      section.addWidget(
        CardService.newTextParagraph().setText(
          "⚠️ Couldn't load your Fizzy accounts: " +
            escapeHtml_(userMessage_(error)),
        ),
      );
    }
  }

  var storedTag = getSetting_(PROP.TAG);

  section.addWidget(
    CardService.newTextInput()
      .setFieldName("default_tag")
      .setTitle("Default tag (optional)")
      .setHint("Added to every new card. Leave empty for no tag.")
      .setValue(storedTag === null ? DEFAULT_TAG : storedTag),
  );

  section.addWidget(
    CardService.newTextInput()
      .setFieldName("base_url")
      .setTitle("Fizzy URL")
      .setHint("Only change this if you self-host Fizzy.")
      .setValue(cfg.baseUrl),
  );

  section.addWidget(
    CardService.newTextButton()
      .setText("Save")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName("saveSettings")
          .setLoadIndicator(CardService.LoadIndicator.SPINNER),
      ),
  );

  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("Fizzy settings"))
    .addSection(section)
    .build();
}

/**
 * "Your email has been added to Fizzy 👍  [ View Card ]"
 * Replaces the form via a navigation update.
 */
function buildSuccessCard_(cardUrl, note) {
  var section = CardService.newCardSection().addWidget(
    CardService.newTextParagraph().setText(
      "<b>Your email has been added to Fizzy 👍</b>",
    ),
  );

  if (note) {
    section.addWidget(
      CardService.newTextParagraph().setText(escapeHtml_(note)),
    );
  }

  section.addWidget(
    CardService.newTextButton()
      .setText("View Card")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOpenLink(CardService.newOpenLink().setUrl(cardUrl)),
  );

  return updateCard_(CardService.newCardBuilder().addSection(section).build());
}

/**
 * Friendly error screen, with a retry and a shortcut to Settings.
 */
function buildErrorCard_(message) {
  var section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText("⚠️ " + escapeHtml_(message)),
    )
    .addWidget(
      CardService.newButtonSet()
        .addButton(
          CardService.newTextButton()
            .setText("Try again")
            .setOnClickAction(
              CardService.newAction().setFunctionName("refreshBoards"),
            ),
        )
        .addButton(settingsTextButton_()),
    );

  return CardService.newCardBuilder().addSection(section).build();
}

function settingsTextButton_() {
  return CardService.newTextButton()
    .setText("Settings")
    .setOnClickAction(CardService.newAction().setFunctionName("openSettings"));
}

function settingsButton_() {
  return CardService.newButtonSet().addButton(settingsTextButton_());
}

/* ============================================================
   FIZZY API
   ============================================================ */

/**
 * Makes an authenticated request to Fizzy.
 * Returns the HTTPResponse on 2xx; throws a friendly Error otherwise.
 * `target` is either a path ("/123/boards.json") or a full URL.
 *
 * Note: response bodies are never logged (they can contain email content).
 */
function fizzyRequest_(cfg, method, target, payload) {
  var url = /^https?:\/\//i.test(target) ? target : cfg.baseUrl + target;

  var options = {
    method: method,
    headers: {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    muteHttpExceptions: true,
  };

  if (payload) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }

  var response;

  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (error) {
    console.error("Could not reach Fizzy: " + error);
    throw friendlyError_(
      "Couldn't reach Fizzy at " +
        cfg.baseUrl +
        ". Check your connection and the Fizzy URL in Settings.",
    );
  }

  var status = response.getResponseCode();

  if (status < 200 || status >= 300) {
    console.error(
      "Fizzy API error " +
        status +
        " on " +
        method.toUpperCase() +
        " " +
        stripOrigin_(url),
    );
    throw friendlyError_(describeStatus_(status));
  }

  return response;
}

/**
 * Lists the Fizzy accounts a token can access.
 * Used both to validate a new token and to find the account slug.
 */
function fetchAccounts_(baseUrl, token) {
  var cfg = { baseUrl: baseUrl, token: token };
  var response = fizzyRequest_(cfg, "get", "/my/identity.json");
  var data = JSON.parse(response.getContentText());

  return (data.accounts || [])
    .map(function (account) {
      return {
        slug: normalizeSlug_(account.slug),
        name: account.name || normalizeSlug_(account.slug),
      };
    })
    .filter(function (account) {
      return account.slug;
    });
}

/**
 * Boards for the configured account, cached for a few minutes so that
 * clicking through your inbox stays fast.
 */
function getBoards_(cfg) {
  var cache = CacheService.getUserCache();
  var key = boardCacheKey_(cfg);

  var cached = cache.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (ignore) {
      /* fall through and refetch */
    }
  }

  var boards = [];
  var url = cfg.baseUrl + "/" + cfg.slug + "/boards.json";
  var pages = 0;

  while (url && pages < MAX_PAGES) {
    var response = fizzyRequest_(cfg, "get", url);
    var page = JSON.parse(response.getContentText());

    if (Array.isArray(page)) {
      page.forEach(function (board) {
        boards.push({ id: String(board.id), name: board.name });
      });
    }

    url = getNextPageUrl_(response, cfg.baseUrl);
    pages++;
  }

  cache.put(key, JSON.stringify(boards), BOARD_CACHE_SECONDS);
  return boards;
}

function clearBoardCache_() {
  CacheService.getUserCache().remove(boardCacheKey_(getConfig_()));
}

function boardCacheKey_(cfg) {
  return "boards:" + cfg.baseUrl + ":" + cfg.slug;
}

/**
 * Adds a tag to a card. Fizzy's "taggings" endpoint toggles the tag and
 * creates it if it doesn't exist yet, which is what we want for a new card.
 * Returns true on success.
 */
function addTag_(cfg, cardNumber, tag) {
  try {
    fizzyRequest_(
      cfg,
      "post",
      "/" + cfg.slug + "/cards/" + cardNumber + "/taggings.json",
      { tag_title: tag },
    );
    return true;
  } catch (error) {
    console.error("Could not add tag: " + error);
    return false;
  }
}

/**
 * Fizzy answers "201 Created" with a Location header pointing at the new card
 * (some versions also include the card JSON). Handle both.
 */
function extractCardNumber_(response) {
  var body = response.getContentText();

  if (body) {
    try {
      var parsed = JSON.parse(body);
      if (parsed && parsed.number) {
        return String(parsed.number);
      }
    } catch (ignore) {
      /* not JSON, fall back to the header */
    }
  }

  var location = getHeader_(response, "Location");
  var match = location ? String(location).match(/\/cards\/(\d+)/) : null;

  return match ? match[1] : null;
}

/**
 * Follows the `Link: <...>; rel="next"` pagination header.
 * Only the path is kept; the host is always our configured Fizzy URL, so the
 * access token can never be sent to another host.
 */
function getNextPageUrl_(response, baseUrl) {
  var link = getHeader_(response, "Link");
  if (!link) {
    return null;
  }

  var match = String(link).match(/<([^>]+)>;\s*rel="?next"?/i);
  if (!match) {
    return null;
  }

  var pathAndQuery = match[1].match(/^https?:\/\/[^\/]+(\/.*)$/);
  return pathAndQuery ? baseUrl + pathAndQuery[1] : null;
}

/* ============================================================
   GMAIL
   ============================================================ */

function getMessageInfo_(e) {
  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);

  var message = GmailApp.getMessageById(e.gmail.messageId);

  return {
    id: e.gmail.messageId,
    subject: message.getSubject(),
    from: message.getFrom(),
    permalink: message.getThread().getPermalink(),
  };
}

/* ============================================================
   SETTINGS & STATE
   ============================================================ */

function getSetting_(key) {
  return PropertiesService.getUserProperties().getProperty(key);
}

function getConfig_() {
  return {
    token: getSetting_(PROP.TOKEN),
    slug: normalizeSlug_(getSetting_(PROP.ACCOUNT)),
    baseUrl: normalizeBaseUrl_(getSetting_(PROP.BASE_URL) || DEFAULT_BASE_URL),
  };
}

function isConfigured_() {
  var cfg = getConfig_();
  return !!(cfg.token && cfg.slug);
}

/**
 * Preselect: the last used board, or the only board if there's just one.
 */
function pickDefaultBoardId_(boards, savedBoardId) {
  if (boards.length === 0) {
    return null;
  }

  if (savedBoardId) {
    var exists = boards.some(function (board) {
      return board.id === savedBoardId;
    });

    if (exists) {
      return savedBoardId;
    }
  }

  return boards.length === 1 ? boards[0].id : null;
}

function rememberCreatedCard_(messageId, cardUrl) {
  CacheService.getUserCache().put(
    "card:" + messageId,
    cardUrl,
    CREATED_CACHE_SECONDS,
  );
}

function getCreatedCardUrl_(messageId) {
  return CacheService.getUserCache().get("card:" + messageId);
}

/* ============================================================
   SMALL HELPERS
   ============================================================ */

function friendlyError_(message) {
  var error = new Error(message);
  error.isFriendly = true;
  return error;
}

function userMessage_(error) {
  if (error && error.isFriendly) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

function describeStatus_(status) {
  if (status === 401) {
    return "Fizzy rejected your access token. Open Settings and paste a new one.";
  }
  if (status === 403) {
    return "Fizzy says this token isn't allowed to do that. Make sure it has Read + Write permission.";
  }
  if (status === 404) {
    return "Fizzy couldn't find that account or board. Check Settings, or refresh the board list.";
  }
  if (status === 429) {
    return "Fizzy is rate limiting requests. Try again in a minute.";
  }
  return "Fizzy returned an error (" + status + "). Please try again.";
}

function notify_(message) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(message))
    .build();
}

function updateCard_(card) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .build();
}

function getFormValue_(formInputs, fieldName) {
  if (!formInputs[fieldName] || !formInputs[fieldName][0]) {
    return "";
  }
  return formInputs[fieldName][0];
}

function getHeader_(response, name) {
  var headers = response.getAllHeaders();
  var wanted = name.toLowerCase();

  for (var key in headers) {
    if (key.toLowerCase() === wanted) {
      var value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return null;
}

function trim_(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function cleanTag_(value) {
  return trim_(value).replace(/^#+/, "").trim();
}

/** "/897362094/" -> "897362094" */
function normalizeSlug_(slug) {
  return trim_(slug).replace(/^\/+|\/+$/g, "");
}

/** Adds https:// if missing and strips trailing slashes. */
function normalizeBaseUrl_(url) {
  var value = trim_(url).replace(/\/+$/, "");

  if (!value) {
    return DEFAULT_BASE_URL;
  }
  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value;
  }
  return value;
}

function stripOrigin_(url) {
  return String(url).replace(/^https?:\/\/[^\/]+/, "");
}

function escapeHtml_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
