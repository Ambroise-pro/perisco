(function () {
  "use strict";

  const DAY_ORDER = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
  const UNDATED_KEY = "__undated__";
  const PX_PER_MIN = 1.5;

  const COL = {
    CLASSE: 0, PERIODE: 1, HDEBUT: 2, HFIN: 3, NOM: 4, PRENOM: 5,
    ACTIVITE: 6, PRIX: 7, FACTURATION: 8, ORG1: 9, ORG2: 10, CRENEAU: 11
  };

  // ---------- State ----------
  let activities = [];       // parsed activities
  let selectedIds = new Set(); // sheetName keys
  let expandedIds = new Set();
  let allConflicts = [];     // global list of schedule conflicts between students
  let state = { search: "", dayFilter: "", classFilter: "", sort: "day", threshold: 5 };

  // ---------- DOM refs ----------
  const fileInput = document.getElementById("fileInput");
  const fileNameEl = document.getElementById("fileName");
  const dropzone = document.getElementById("dropzone");
  const workspace = document.getElementById("workspace");
  const activityTableWrap = document.getElementById("activityTableWrap");
  const summaryBar = document.getElementById("summaryBar");
  const searchInput = document.getElementById("searchInput");
  const dayFilterSel = document.getElementById("dayFilter");
  const classFilterSel = document.getElementById("classFilter");
  const sortSelect = document.getElementById("sortSelect");
  const selectAllBtn = document.getElementById("selectAllBtn");
  const selectNoneBtn = document.getElementById("selectNoneBtn");
  const planningGrid = document.getElementById("planningGrid");
  const undatedListEl = document.getElementById("undatedList");
  const planningSelectionCount = document.getElementById("planningSelectionCount");
  const goToListBtn = document.getElementById("goToListBtn");
  const modalOverlay = document.getElementById("modalOverlay");
  const modalContent = document.getElementById("modalContent");
  const modalClose = document.getElementById("modalClose");
  const thresholdInput = document.getElementById("thresholdInput");

  function thresholdClass(count) {
    return count < state.threshold ? "threshold-low" : "threshold-high";
  }

  thresholdInput.addEventListener("input", function (e) {
    const v = parseInt(e.target.value, 10);
    state.threshold = isNaN(v) || v < 0 ? 0 : v;
    renderList();
    renderPlanning();
  });

  // ================= File loading =================

  function handleFile(file) {
    if (!file) return;
    fileNameEl.textContent = file.name;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        activities = parseWorkbook(wb);
        selectedIds = new Set();
        expandedIds = new Set();
        onWorkbookLoaded();
      } catch (err) {
        console.error(err);
        alert("Impossible de lire ce fichier Excel : " + err.message);
      }
    };
    reader.onerror = function () {
      alert("Erreur lors de la lecture du fichier.");
    };
    reader.readAsArrayBuffer(file);
  }

  function parseWorkbook(wb) {
    const result = [];
    wb.SheetNames.forEach(function (sheetName, idx) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const dataRows = rows.slice(1).filter(function (r) {
        return r && String(r[COL.NOM] || "").trim() !== "";
      });

      const first = dataRows[0] || [];
      const m = sheetName.match(/^(\d+)\s*(.*)$/);
      const numericId = m ? m[1] : null;
      const tabLabel = (m ? m[2] : sheetName).trim();

      const rawDay = String(first[COL.PERIODE] || "").trim();
      const isRealDay = DAY_ORDER.indexOf(rawDay) !== -1;
      const rawStart = String(first[COL.HDEBUT] || "").trim();
      const rawEnd = String(first[COL.HFIN] || "").trim();

      const activityName = String(first[COL.ACTIVITE] || "").trim() || tabLabel || sheetName;
      const org = [first[COL.ORG1], first[COL.ORG2]]
        .map(function (v) { return String(v || "").trim(); })
        .filter(Boolean)
        .join(" / ");

      const students = dataRows.map(function (r) {
        return {
          classe: String(r[COL.CLASSE] || "").trim(),
          nom: String(r[COL.NOM] || "").trim(),
          prenom: String(r[COL.PRENOM] || "").trim(),
          prix: r[COL.PRIX]
        };
      });

      result.push({
        key: sheetName,
        sheetIndex: idx,
        numericId: numericId,
        tabLabel: tabLabel,
        activityName: activityName,
        organisateur: org,
        day: isRealDay ? rawDay : null,
        rawDayLabel: rawDay || null,
        start: isRealDay ? toHHMM(rawStart) : null,
        end: isRealDay ? toHHMM(rawEnd) : null,
        students: students,
        count: students.length
      });
    });
    return result;
  }

  function toHHMM(s) {
    if (!s) return null;
    const parts = s.split(":");
    if (parts.length < 2) return null;
    return parts[0].padStart(2, "0") + ":" + parts[1].padStart(2, "0");
  }

  function timeToMinutes(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function studentKey(s) {
    return (s.nom + "|" + s.prenom).toUpperCase().trim();
  }

  // Detects students enrolled in two activities that overlap on the same day/time.
  // Mutates each activity with a `conflictMap` (studentKey -> [{name, day, start, end}])
  // and returns the flat list of conflicting pairs for the summary modal.
  function computeConflicts(list) {
    const byStudent = new Map();
    list.forEach(function (a) {
      a.conflictMap = new Map();
      if (!(a.day && a.start && a.end)) return;
      const s = timeToMinutes(a.start), e = timeToMinutes(a.end);
      a.students.forEach(function (stu) {
        const key = studentKey(stu);
        if (!key.replace(/\|/g, "").trim()) return;
        if (!byStudent.has(key)) byStudent.set(key, []);
        byStudent.get(key).push({ key: key, nom: stu.nom, prenom: stu.prenom, classe: stu.classe, activity: a, day: a.day, s: s, e: e });
      });
    });

    const conflicts = [];
    byStudent.forEach(function (enrollments) {
      for (let i = 0; i < enrollments.length; i++) {
        for (let j = i + 1; j < enrollments.length; j++) {
          const A = enrollments[i], B = enrollments[j];
          if (A.day !== B.day || A.activity === B.activity) continue;
          const overlap = A.s < B.e && B.s < A.e;
          if (!overlap) continue;

          conflicts.push({
            nom: A.nom, prenom: A.prenom, classe: A.classe || B.classe, day: A.day,
            a: { name: A.activity.activityName, start: A.activity.start, end: A.activity.end, key: A.activity.key },
            b: { name: B.activity.activityName, start: B.activity.start, end: B.activity.end, key: B.activity.key }
          });

          addConflictNote(A.activity, A.key, B.activity);
          addConflictNote(B.activity, B.key, A.activity);
        }
      }
    });
    return conflicts;

    function addConflictNote(activity, key, other) {
      if (!activity.conflictMap.has(key)) activity.conflictMap.set(key, []);
      activity.conflictMap.get(key).push({ name: other.activityName, day: other.day, start: other.start, end: other.end });
    }
  }

  // ================= Init after load =================

  function onWorkbookLoaded() {
    dropzone.classList.add("hidden");
    workspace.classList.remove("hidden");
    allConflicts = computeConflicts(activities);
    populateDayFilter();
    populateClassFilter();
    renderList();
    renderPlanning();
  }

  function populateClassFilter() {
    const classes = new Set();
    activities.forEach(function (a) {
      a.students.forEach(function (s) { if (s.classe) classes.add(s.classe); });
    });
    const sorted = Array.from(classes).sort(function (a, b) { return a.localeCompare(b, "fr", { numeric: true }); });
    classFilterSel.innerHTML = '<option value="">Toutes les classes</option>';
    sorted.forEach(function (c) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      classFilterSel.appendChild(opt);
    });
  }

  function populateDayFilter() {
    const daysPresent = new Set();
    let hasUndated = false;
    activities.forEach(function (a) {
      if (a.day) daysPresent.add(a.day);
      else hasUndated = true;
    });
    dayFilterSel.innerHTML = '<option value="">Tous les jours</option>';
    DAY_ORDER.forEach(function (d) {
      if (daysPresent.has(d)) {
        const opt = document.createElement("option");
        opt.value = d;
        opt.textContent = d;
        dayFilterSel.appendChild(opt);
      }
    });
    if (hasUndated) {
      const opt = document.createElement("option");
      opt.value = UNDATED_KEY;
      opt.textContent = "Sans horaire défini";
      dayFilterSel.appendChild(opt);
    }
  }

  // ================= List view =================

  function getFilteredSorted() {
    const term = state.search.trim().toLowerCase();
    let list = activities.filter(function (a) {
      if (state.dayFilter) {
        if (state.dayFilter === UNDATED_KEY) {
          if (a.day) return false;
        } else if (a.day !== state.dayFilter) {
          return false;
        }
      }
      if (state.classFilter && !a.students.some(function (s) { return s.classe === state.classFilter; })) {
        return false;
      }
      if (!term) return true;
      const haystacks = [a.activityName, a.organisateur, a.tabLabel, a.numericId || ""];
      if (haystacks.some(function (h) { return h && h.toLowerCase().indexOf(term) !== -1; })) return true;
      return a.students.some(function (s) {
        return (s.nom + " " + s.prenom).toLowerCase().indexOf(term) !== -1;
      });
    });

    list.sort(function (a, b) {
      switch (state.sort) {
        case "name":
          return a.activityName.localeCompare(b.activityName, "fr");
        case "count-desc":
          return b.count - a.count;
        case "count-asc":
          return a.count - b.count;
        default: {
          const da = a.day ? DAY_ORDER.indexOf(a.day) : 99;
          const db = b.day ? DAY_ORDER.indexOf(b.day) : 99;
          if (da !== db) return da - db;
          const ta = timeToMinutes(a.start);
          const tb = timeToMinutes(b.start);
          if (ta === null && tb === null) return a.activityName.localeCompare(b.activityName, "fr");
          if (ta === null) return 1;
          if (tb === null) return -1;
          return ta - tb;
        }
      }
    });
    return list;
  }

  function renderList() {
    const list = getFilteredSorted();
    const totalStudents = list.reduce(function (s, a) { return s + a.count; }, 0);
    const selectedCount = activities.filter(function (a) { return selectedIds.has(a.key); }).length;

    const conflictHtml = allConflicts.length > 0
      ? '<span><button class="conflict-warn-btn" id="viewConflictsBtn">⚠ ' + allConflicts.length + ' conflit(s) d\'horaire</button></span>'
      : '<span class="conflict-ok">✓ Aucun conflit d\'horaire détecté</span>';

    summaryBar.innerHTML =
      '<span><b>' + activities.length + '</b> onglet(s) au total</span>' +
      '<span><b>' + list.length + '</b> affiché(s) avec le filtre actuel</span>' +
      '<span><b>' + totalStudents + '</b> inscription(s) dans la sélection filtrée</span>' +
      '<span><b>' + selectedCount + '</b> activité(s) sélectionnée(s) pour le planning</span>' +
      conflictHtml;

    const viewConflictsBtn = document.getElementById("viewConflictsBtn");
    if (viewConflictsBtn) viewConflictsBtn.addEventListener("click", openConflictsModal);

    if (list.length === 0) {
      activityTableWrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Aucune activité ne correspond à ce filtre.</div>';
      return;
    }

    const rowsHtml = list.map(renderActivityRow).join("");
    activityTableWrap.innerHTML =
      '<table class="activity-table"><thead><tr>' +
      '<th></th><th>Jour</th><th>Horaire</th><th>Activité</th><th>Organisateur</th><th>Inscrits</th><th></th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
  }

  function renderActivityRow(a) {
    const checked = selectedIds.has(a.key) ? "checked" : "";
    const expanded = expandedIds.has(a.key);
    const dayHtml = a.day
      ? '<span class="day-badge">' + a.day + '</span>'
      : '<span class="day-badge undated">' + (a.rawDayLabel || "Sans horaire") + '</span>';
    const timeHtml = a.start && a.end ? (a.start + ' – ' + a.end) : '<span style="color:var(--text-muted)">—</span>';
    const countClass = "count-badge " + thresholdClass(a.count);
    const idBadge = a.numericId ? ('#' + a.numericId + ' · ') : '';
    const conflictCount = a.conflictMap ? a.conflictMap.size : 0;
    const conflictFlag = conflictCount > 0
      ? '<span class="conflict-flag" title="' + conflictCount + ' élève(s) avec un conflit d\'horaire">⚠</span>'
      : '';

    let html =
      '<tr class="' + (a.count === 0 ? "empty-row" : "") + '" data-key="' + escapeAttr(a.key) + '">' +
      '<td><input type="checkbox" class="select-cb" data-key="' + escapeAttr(a.key) + '" ' + checked + '></td>' +
      '<td>' + dayHtml + '</td>' +
      '<td>' + timeHtml + '</td>' +
      '<td class="activity-name-cell">' + escapeHtml(a.activityName) +
      '<span class="activity-sub">' + idBadge + escapeHtml(a.tabLabel) + '</span></td>' +
      '<td>' + escapeHtml(a.organisateur || "—") + '</td>' +
      '<td><span class="' + countClass + '">' + a.count + '</span>' + conflictFlag + '</td>' +
      '<td><button class="expand-btn" data-key="' + escapeAttr(a.key) + '">' + (expanded ? "▾ masquer" : "▸ élèves") + '</button></td>' +
      '</tr>';

    if (expanded) {
      if (a.students.length === 0) {
        html += '<tr class="student-row last"><td colspan="7"><em>Aucun élève inscrit.</em></td></tr>';
      } else {
        a.students.forEach(function (s, i) {
          const last = i === a.students.length - 1 ? " last" : "";
          const key = studentKey(s);
          const stuConflicts = a.conflictMap ? a.conflictMap.get(key) : null;
          const conflictNote = stuConflicts && stuConflicts.length
            ? '<span class="conflict-note">⚠ conflit avec ' + stuConflicts.map(function (c) {
                return escapeHtml(c.name) + ' (' + c.day + ' ' + c.start + '–' + c.end + ')';
              }).join(", ") + '</span>'
            : '';
          html += '<tr class="student-row' + last + '"><td colspan="7">' +
            '<span class="stu-name">' + escapeHtml(s.nom) + ' ' + escapeHtml(s.prenom) + '</span>' +
            (s.classe ? '  —  classe ' + escapeHtml(s.classe) : '') +
            conflictNote +
            '</td></tr>';
        });
      }
    }
    return html;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }

  activityTableWrap.addEventListener("click", function (e) {
    const expandBtn = e.target.closest(".expand-btn");
    if (expandBtn) {
      const key = expandBtn.dataset.key;
      if (expandedIds.has(key)) expandedIds.delete(key);
      else expandedIds.add(key);
      renderList();
      return;
    }
  });

  activityTableWrap.addEventListener("change", function (e) {
    if (e.target.classList.contains("select-cb")) {
      const key = e.target.dataset.key;
      if (e.target.checked) selectedIds.add(key);
      else selectedIds.delete(key);
      renderList();
      renderPlanning();
    }
  });

  searchInput.addEventListener("input", function (e) {
    state.search = e.target.value;
    renderList();
  });
  dayFilterSel.addEventListener("change", function (e) {
    state.dayFilter = e.target.value;
    renderList();
  });
  classFilterSel.addEventListener("change", function (e) {
    state.classFilter = e.target.value;
    renderList();
  });
  sortSelect.addEventListener("change", function (e) {
    state.sort = e.target.value;
    renderList();
  });

  selectAllBtn.addEventListener("click", function () {
    getFilteredSorted().forEach(function (a) { selectedIds.add(a.key); });
    renderList();
    renderPlanning();
  });
  selectNoneBtn.addEventListener("click", function () {
    getFilteredSorted().forEach(function (a) { selectedIds.delete(a.key); });
    renderList();
    renderPlanning();
  });

  // ================= Planning view =================

  const COLORS = [
    "#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed",
    "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488"
  ];
  function colorFor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return COLORS[hash % COLORS.length];
  }

  function renderPlanning() {
    const selected = activities.filter(function (a) { return selectedIds.has(a.key); });
    const dated = selected.filter(function (a) { return a.day && a.start && a.end; });
    const undated = selected.filter(function (a) { return !(a.day && a.start && a.end); });

    const totalStudents = selected.reduce(function (s, a) { return s + a.count; }, 0);
    planningSelectionCount.textContent = selected.length + ' activité(s) sélectionnée(s) — ' + totalStudents + ' inscription(s) au total';

    renderUndated(undated);

    if (dated.length === 0) {
      planningGrid.innerHTML = '<div class="empty-planning">Aucune activité datée sélectionnée.<br>Cochez des activités dans l\'onglet « Liste des activités » pour les voir apparaître ici.</div>';
      planningGrid.style.gridTemplateRows = "";
      return;
    }

    let minM = Math.min.apply(null, dated.map(function (a) { return timeToMinutes(a.start); }));
    let maxM = Math.max.apply(null, dated.map(function (a) { return timeToMinutes(a.end); }));
    minM = Math.floor(minM / 30) * 30;
    maxM = Math.ceil(maxM / 30) * 30;
    minM = Math.min(minM, 8 * 60);
    maxM = Math.max(maxM, 17 * 60);

    const totalHeight = (maxM - minM) * PX_PER_MIN;

    let html = '<div class="grid-header"></div>';
    DAY_ORDER.forEach(function (d) {
      html += '<div class="grid-header">' + d + '</div>';
    });

    html += '<div class="day-col time-col" style="height:' + totalHeight + 'px">';
    for (let t = minM; t <= maxM; t += 30) {
      const top = (t - minM) * PX_PER_MIN;
      const label = String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
      html += '<span class="time-label" style="top:' + top + 'px">' + label + '</span>';
    }
    html += '</div>';

    DAY_ORDER.forEach(function (day) {
      const dayEvents = dated.filter(function (a) { return a.day === day; })
        .map(function (a) {
          return Object.assign({}, a, { s: timeToMinutes(a.start), e: timeToMinutes(a.end) });
        });
      layoutDay(dayEvents);

      let colHtml = '<div class="day-col" style="height:' + totalHeight + 'px">';
      dayEvents.forEach(function (ev) {
        const top = (ev.s - minM) * PX_PER_MIN;
        const height = Math.max((ev.e - ev.s) * PX_PER_MIN, 22);
        const widthPct = 100 / ev._totalCols;
        const leftPct = ev._col * widthPct;
        const bg = colorFor(ev.activityName);
        colHtml += '<div class="event-block ' + thresholdClass(ev.count) + '" style="top:' + top + 'px;height:' + height + 'px;left:calc(' + leftPct + '% + 2px);width:calc(' + widthPct + '% - 4px);background:' + bg + '" data-key="' + escapeAttr(ev.key) + '">' +
          '<span class="ev-title">' + escapeHtml(ev.activityName) + '</span>' +
          '<span class="ev-time">' + ev.start + '–' + ev.end + '</span>' +
          '<span class="ev-count">' + ev.count + ' él.</span>' +
          '</div>';
      });
      colHtml += '</div>';
      html += colHtml;
    });

    planningGrid.style.gridTemplateRows = "auto " + totalHeight + "px";
    planningGrid.innerHTML = html;
  }

  function layoutDay(events) {
    events.sort(function (a, b) { return a.s - b.s; });
    let cluster = [];
    let clusterEnd = -Infinity;
    const clusters = [];
    events.forEach(function (ev) {
      if (cluster.length && ev.s >= clusterEnd) {
        clusters.push(cluster);
        cluster = [];
        clusterEnd = -Infinity;
      }
      cluster.push(ev);
      clusterEnd = Math.max(clusterEnd, ev.e);
    });
    if (cluster.length) clusters.push(cluster);

    clusters.forEach(function (cl) {
      const laneEnds = []; // end time per lane
      cl.forEach(function (ev) {
        let placed = false;
        for (let i = 0; i < laneEnds.length; i++) {
          if (laneEnds[i] <= ev.s) {
            laneEnds[i] = ev.e;
            ev._col = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          ev._col = laneEnds.length;
          laneEnds.push(ev.e);
        }
      });
      const totalCols = laneEnds.length;
      cl.forEach(function (ev) { ev._totalCols = totalCols; });
    });
  }

  function renderUndated(undated) {
    if (undated.length === 0) {
      undatedListEl.innerHTML = "";
      return;
    }
    let html = '<h3>Activités sélectionnées sans horaire défini (' + undated.length + ')</h3><div class="undated-chips">';
    undated.forEach(function (a) {
      html += '<div class="undated-chip ' + thresholdClass(a.count) + '" data-key="' + escapeAttr(a.key) + '">' +
        escapeHtml(a.activityName) +
        '<span class="count-badge ' + thresholdClass(a.count) + '">' + a.count + '</span>' +
        '</div>';
    });
    html += '</div>';
    undatedListEl.innerHTML = html;
  }

  planningGrid.addEventListener("click", function (e) {
    const block = e.target.closest(".event-block");
    if (block) openModal(block.dataset.key);
  });
  undatedListEl.addEventListener("click", function (e) {
    const chip = e.target.closest(".undated-chip");
    if (chip) openModal(chip.dataset.key);
  });

  function openModal(key) {
    const a = activities.find(function (x) { return x.key === key; });
    if (!a) return;
    const meta = [
      a.numericId ? ("#" + a.numericId) : null,
      a.day || a.rawDayLabel || "Sans horaire",
      (a.start && a.end) ? (a.start + "–" + a.end) : null,
      a.organisateur || null
    ].filter(Boolean).join(" · ");

    let listHtml = "<p><em>Aucun élève inscrit.</em></p>";
    if (a.students.length) {
      listHtml = "<ol>" + a.students.map(function (s) {
        return "<li><strong>" + escapeHtml(s.nom) + "</strong> " + escapeHtml(s.prenom) +
          (s.classe ? " — " + escapeHtml(s.classe) : "") + "</li>";
      }).join("") + "</ol>";
    }

    modalContent.innerHTML =
      "<h2>" + escapeHtml(a.activityName) + "</h2>" +
      '<div class="modal-meta">' + escapeHtml(meta) + " — " + a.count + " inscrit(s)</div>" +
      listHtml;
    modalOverlay.classList.remove("hidden");
  }

  function openConflictsModal() {
    let listHtml;
    if (allConflicts.length === 0) {
      listHtml = "<p><em>Aucun conflit d'horaire détecté.</em></p>";
    } else {
      listHtml = "<ul class=\"conflicts-modal-list\">" + allConflicts.map(function (c) {
        return "<li><span class=\"stu\">" + escapeHtml(c.nom) + " " + escapeHtml(c.prenom) + "</span>" +
          (c.classe ? " (" + escapeHtml(c.classe) + ")" : "") + " — " + escapeHtml(c.day) + "<br>" +
          escapeHtml(c.a.name) + " " + c.a.start + "–" + c.a.end +
          "<span class=\"vs\">⚡ chevauche ⚡</span>" +
          escapeHtml(c.b.name) + " " + c.b.start + "–" + c.b.end +
          "</li>";
      }).join("") + "</ul>";
    }
    modalContent.innerHTML =
      "<h2>Conflits d'horaire</h2>" +
      '<div class="modal-meta">' + allConflicts.length + " conflit(s) détecté(s) — un même élève inscrit à deux activités qui se chevauchent</div>" +
      listHtml;
    modalOverlay.classList.remove("hidden");
  }

  modalClose.addEventListener("click", function () { modalOverlay.classList.add("hidden"); });
  modalOverlay.addEventListener("click", function (e) {
    if (e.target === modalOverlay) modalOverlay.classList.add("hidden");
  });

  // ================= View switching =================

  document.querySelectorAll(".viewTab").forEach(function (btn) {
    btn.addEventListener("click", function () { switchView(btn.dataset.view); });
  });
  goToListBtn.addEventListener("click", function () { switchView("list"); });

  function switchView(view) {
    document.querySelectorAll(".viewTab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.view === view);
    });
    document.getElementById("view-list").classList.toggle("hidden", view !== "list");
    document.getElementById("view-planning").classList.toggle("hidden", view !== "planning");
    if (view === "planning") renderPlanning();
  }

  // ================= File input / drag & drop =================

  fileInput.addEventListener("change", function (e) { handleFile(e.target.files[0]); });

  ["dragenter", "dragover"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", function (e) {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });
  dropzone.addEventListener("click", function () { fileInput.click(); });

})();
