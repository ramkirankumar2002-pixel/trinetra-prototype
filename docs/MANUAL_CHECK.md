# Manual-style check of the running app

Done on 2026-11-27 and 28 (midnight in India passed during test 1), on the code of commit `8eaa800`. No code was changed for the check. **The issues were dealt with afterwards (2026-11-28): 11 fixed, 3 are design choices left as they are.** Each issue below has its status; the descriptions and screenshots show the app as it was during the check.

**Screenshots:** the file names below are in `docs/screenshots/manual-check/` (63 pictures). They are **kept on the development computer only**: the folder is in `.gitignore`.

## Results

| Test | Result | What was seen |
| --- | --- | --- |
| **1. Type 1, Steel Bars** | **PASS**, but History is wrong (issue 1) | It reached Vikram's phone 0.15 s after the kiosk's tap; Amit's page stayed empty. The kiosk showed Vikram's approval 0.12 s after the tap. Final slip: 14,310 kg net, 0% variance, PASS. |
| **2. Type 2, Aggregate 20 mm** (14,500 kg bill) | **PASS** | The kiosk said "Please move aside and wait". No first weight was saved (32,560 kg held). Ram got the request after 0.09 s. After Approve, the kiosk went on after 0.13 s and the first weight was saved. |
| **3. "No phone?"** | **PASS** | The QR code went and the waiting card appeared. Ram got "Driver help" and uploaded the cement bill; the kiosk went on after 0.12 s. The truck was left at the supplier question and not weighed. |

- Updates arrived without any page reload (page loads were counted from login on).
- English and Hindi were looked at in all three tests.
- No console errors or failed requests, apart from the expected "not logged in" answers on the login pages.
- The times are from demo mode with everything on one computer. They say nothing about real plate or bill reading.
- Nothing was noticeably slow. The 3 second wait while weighing is intended.
- Because midnight passed during test 1, its truck counted as completed on the 28th, and ticket numbers started again at `0001`.

## Issues

Each fix has a test: unit tests beside the code, API tests (`store-pages`, `details`, `supervisor`), and `tests/e2e/manual-check-fixes.spec.ts`, which takes one truck through all of them on the real screens.

### Serious

#### 1. History says "Blocked by supervisor" for an approved truck

**Status: Fixed.** History and the ticket page now say what was really answered: "Approved by supervisor", "Rejected by supervisor", "Approved by store", "Rejected by store" or "Seen by store". The decision card says "Decided by" (it said "Approved by" for a rejection too).

- **Screen:** store officer, History (list) and the ticket page ("Who decided what"), in English and Hindi.
- **What is wrong:** the truck Vikram **approved** reads "**Blocked by supervisor:** approved by Vikram Sharma, 00:00". The status beside it says Completed. This is a bug in the store pages; the automated tests did not catch it.
- **Screenshots:** `t3-12-store-history.png`, `t1-35-store-history-detail-wrong-label.png`, `t3-13-store-history-hindi.png`

#### 2. The supervisor's photo "matches" a different plate

**Status: Fixed.** The result, "Done" and the store officer's timeline now say it is a demo reading and the photo was not read. Demo mode still does not read the photo: that is what the mode is for.

- **Screen:** supervisor, Verify truck (the photo's preview and result).
- **What is wrong:** the photo plainly shows **MH 12 AB 1234**, but the page says "Read from your photo: **RJ 14 LM 2345**" and a green "**Plate matches**". Demo "pick" mode does not read the photo, and the result is not marked as demo. In a demo, the fraud check would look broken.
- **Screenshots:** `t1-21-vikram-preview.png`, `t1-22-vikram-result.png`, `t1-24-vikram-result-hindi.png`

### Confusing

#### 3. The store officer's timeline says "your photo"

**Status: Fixed.** The store officer's timeline says "Read from the supervisor's photo" (or "Demo reading (photo not read)").

- **Screen:** store officer, ticket page, Timeline ("Supervisor took a photo" and "Supervisor approved").
- **What is wrong:** it says "**Read from your photo:** RJ 14 LM 2345". The photo was Vikram's, not the store officer's.
- **Screenshot:** `t1-36-store-history-timeline.png`

#### 4. "Driver's answers saved" is repeated, with no detail

**Status: Fixed.** Each line now says what was saved (never the name or number), and a switch of language adds no line. Lines already saved for a language switch read "Language changed".

- **Screen:** store officer, Timeline (request page and ticket page).
- **What is wrong:** the Steel Bars truck has the line six times, and none says what was saved. Only switching the kiosk's language also adds a line: on the "No phone?" truck, two appeared after switching to Hindi and back, before any question had been answered.
- **Screenshot:** `t1-36-store-history-timeline.png` shows some of the repeated lines. The count and the language case were read from the page's text; no picture shows all of them.

#### 5. Two red buttons: "Reject" and "Cancel visit"

**Status: Fixed.** "Cancel visit" is now a quiet button, set apart, with one line saying it is not a rejection and does not block the plate.

- **Screen:** store officer, a request's page (seen on the Type 2 request).
- **What is wrong:** both are red and sit one above the other. How they differ is explained only after "Cancel visit" is pressed.
- **Screenshots:** `t2-04-store-detail.png`, `t2-06-store-detail-hindi.png`

#### 6. A Type 2 slip names a supervisor who has nothing to approve

**Status: Not a bug.** A design choice: the build plan (section 12) puts the unloading point's contact on every first slip. Changing the slip's words for Type 2 and 3 needs your decision.

- **Screen:** kiosk, first slip of the Type 2 truck.
- **What is wrong:** it says "**Go to CH-003+750**, Suresh Yadav" with a phone number. Suresh is only the contact at that point and is asked nothing. A driver may think they have to wait for an approval. (The build plan does put the contact on the slip.)
- **Screenshot:** `t2-07-kiosk-continued-slip.png`

#### 7. A "No phone?" call does not say that a bill is needed

**Status: Fixed.** After "No phone?" the list, the message and the page say "No phone: send bill" until the bill has been read.

- **Screen:** store officer, Approvals list.
- **What is wrong:** it shows only "**Driver help**", with dashes for material and invoice weight. It looks the same as any other help call.
- **Screenshot:** `t3-03-store-help-in-queue.png`

#### 8. It is not clear what "Edit" does on the check screen

**Status: Not a bug.** A design choice: "Edit" is the build plan's "Change" button; it highlights the lines that can change and shows "Tap the line to change".

- **Screen:** kiosk, Check ("Is everything correct?").
- **What is wrong:** every line that can change already has a pencil, and there is also a large "**Edit**" button. "Edit" was not pressed during the check.
- **Screenshot:** `t1-12-kiosk-check.png`

### Small or ugly

#### 9. "Send the bill" runs off the bottom of the screen

**Status: Fixed.** At 1366×768 the bill preview is lower and "Send the bill" comes first; both buttons are on the screen without scrolling.

- **Screen:** store officer at 1366×768, "Upload bill for driver", after choosing the file.
- **What is wrong:** "**Send the bill**" and "**Choose another**" are cut off at the bottom edge, so the officer has to scroll.
- **Screenshot:** `t3-06-store-bill-preview.png`

#### 10. Button labels wrap onto two lines

**Status: Fixed.** In narrow places the buttons are stacked, one to a line (checked in English).

- **Screen:** store officer, bill upload (laptop); supervisor, Verify truck (phone).
- **What is wrong:** "**Take photo**", "**Choose file**", "**Send the bill**", "**Choose another**", "**Use this photo**" and "**Retake (2 left)**" break over two lines.
- **Screenshots:** `t3-05-store-upload-page.png`, `t3-06-store-bill-preview.png`, `t1-21-vikram-preview.png`, `t1-22-vikram-result.png`

#### 11. The weighing screen asks the same question twice

**Status: Fixed.** The ring no longer repeats the heading; under it only the reason a weight cannot be taken is said.

- **Screen:** kiosk, First weight.
- **What is wrong:** "**Is this weight right?**" is both under the heading and under the ring.
- **Screenshot:** `t1-14-kiosk-weight-confirm.png`

#### 12. The bill's date is written differently

**Status: Fixed.** Bill dates read "26 Nov 2026" on the weighbridge screen and the store officer's pages.

- **Screen:** kiosk, "Check what was read" (also the bill card on the store officer's pages).
- **What is wrong:** it shows `2026-11-26`, while other dates read like "28 Nov 2026".
- **Screenshots:** `t1-06-kiosk-invoice-read.png`, `t2-05-store-detail-full.png`

#### 13. The supervisor's home: covered cards, and "Online" twice

**Status: Not a bug.** Design choices: the message leaves after 4 seconds, and the home page's "Connection:" line was built on purpose beside the top bar's light. Either can be changed if you wish.

- **Screen:** supervisor, Home (phone).
- **What is wrong:** the "New truck" message covers parts of the number cards for a few seconds. "**Online**" is shown in the top bar and again under "Connection:".
- **Screenshots:** `t1-16-vikram-new-truck.png`, `t0-vikram-home-before.png`

#### 14. A skipped name shows as dashes

**Status: Fixed.** A skipped name reads "Not given" ("नहीं बताया").

- **Screen:** kiosk, Check.
- **What is wrong:** after "Skip", Name shows as "**———**", which reads like something missing or broken.
- **Screenshot:** `t1-12-kiosk-check.png`

## Found while fixing (not in the list, not fixed)

### The first tap on a staff home page can be lost

- **Screen:** supervisor Home (the "Verify" button) and, built the same way, store officer Home (the "Open" buttons).
- **What is wrong:** until the page has been tapped once, it shows "Tap the screen once to turn on the sound…". The very first tap removes that line **as the finger goes down**, so everything below it jumps up before the finger lifts, and the button is not pressed. The second tap works.
- **How it was found:** the new browser test pressed "Verify" first; nothing happened and no request was sent. With one tap elsewhere before it, the same test passes. Seen on the supervisor's page; the store officer's was not tried. The manual check and the older tests tapped a heading first, so they missed it.
- **Status:** not fixed.

## How the check was done

- **Start:** `pnpm office reset`, `pnpm office pick …` for each truck, and the ESP32 simulator (`--loaded 32560`). The app was `pnpm dev`, already running from the app's `dev` preview.
- **Browser:** separate headless windows of the installed Chrome, one per device with its own login, driven one step at a time by a temporary script outside the project, clicking the visible buttons. The app's built-in browser pane was not used for the check: its tabs share one login, and it cannot save pictures.
- **Sizes:** kiosk and store officer 1366×768; supervisors 390×844; the driver's phone 390×844.
- **Cameras and files:** camera access was switched off in the supervisor windows, so the page offered the phone's camera app. The script handed files to the file choosers; the test plate was `scripts/sample-plates/match-front.jpg`. The QR code's address was opened in a separate driver window instead of being scanned.
- **Extra check:** for test 2 the ticket was also read from the server, before and after the approval, to confirm what had been saved.
- **After:** demo modes were switched off, and the servers and the simulator were stopped. The test tickets stayed in the local development database.

## Not tried

Printing, the sound, a real phone, a real touchscreen, a real camera, and real plate or bill reading.
