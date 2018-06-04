'use strict';

var ContentType = require('../../').BaseType;
var _ = require('lodash');
var formsUtil = require('../utils/forms');
var forms = require('forms');
var fields = forms.fields;
var widgets = forms.widgets;
var validateTime;
var cloudinary = require('cloudinary');
var cloudimage = require('../utils/cloudimage');
var Tags = require('../utils/tags');

validateTime = function (message) {
  if (!message) { message = 'Must be a valid time in the format "HH:MM"'; }
  var splitRegex = /[.,:]/;
  return function (form, field, callback) {
    var parts = field.data ? field.data.split(splitRegex) : [];
    var hours = parseInt(parts[0] || '', 10);
    var minutes = parseInt(parts[1] || '', 10);

    if (!isNaN(hours) && hours >= 0 && hours < 24 && !isNaN(minutes) && minutes >= 0 && minutes < 60) {
      callback();
    } else {
      callback(message);
    }
  };
};

module.exports = ContentType.extend({
  constructor : function (options) {
    options = _.extend({
      id : 'agenda',
      name : 'Agenda',
    }, options || {});

    ContentType.call(this, options);

    this.getPath = true;
    this.deletePath = true;
    this.formListTemplate = 'admin-list-agenda';
    this.speakerProviders = [];
  },
  hasIntegrations: function () {
    return ['speakers'];
  },
  addIntegration : function (contentType) {
    if (contentType.id === 'speakers') {
      contentType.addAgendaProvider((fo, fi) => this._agendas(fo, fi));
    }
  },
  addSpeakerProvider: function (provider) {
    this.speakerProviders.push(provider);
  },
  _agendas: function (fullObjects, filtered) {
    fullObjects = !!fullObjects;
    return this.getList(filtered)
      .then((agendas) => {
        if (fullObjects) { return agendas; }

        const list = agendas.reduce((previous, current) => {
          previous[current.id] = current.title;
          return previous;
        }, {});

        return list;
      });
  },
  getFormData: function (currentPage) {
    let promises = [this._agendas()];

    const integrations = this.hasIntegrations();
    if (Array.isArray(integrations) && integrations.indexOf('speakers') !== -1) {
      promises.push(this.getSpeakers().then((_speakers) => {
        let speakers = {};
        let key;
        _speakers.forEach((itm) => {
          for (key in itm) {
            if (!itm.hasOwnProperty(key)) { continue; }
            speakers[itm[key].id] = itm[key].name;
          }
        });

        return speakers;
      }));
    }
    return Promise.all(promises).then((result) => {
      return {
        agendas: result[0],
        speakers: result[1],
      };
    });
  },
  getSpeakers: function (filtered) {
    const speakerPromises = this.speakerProviders.map(fn => {
      if (typeof fn.then === 'function') {
        return fn;
      } else {
        return new Promise((resolve, reject) => {
          resolve(fn(filtered));
        });
      }
    });

    return Promise.all(speakerPromises);
  },
  getData: function (page, reset) {
    let data = ContentType.prototype.getData.apply(this, arguments);

    return data.then(result => {
      return Promise.all(result.map(agenda => {
        return Promise.all([
          Promise.resolve(agenda),
          this.getRelatedSpeakers(agenda.id),
          this.getRelatedAgendas(agenda.id),
          Tags.getAgendaTags(agenda.id, this.knex)
        ]).then(([agenda, speakers, agendas, tags]) => {
          agenda.relatedSpeakers = speakers;
          agenda.relatedAgendas = agendas;
          agenda.tags = tags || [];
          return agenda;
        });
      }));
    });
  },
  getDataQuery : function () {
    return this.knex('agenda')
      .select('id', 'title', 'description', 'start', 'stop', 'category', 'speaker', 'data')
      .where('published', true)
      .orderBy('start', 'asc')
      .orderBy('category', 'asc')
      .then(items =>
        items.map(item =>
          Object.assign(item, item.data, { data: undefined })
        )
      );
  },
  getTemplate : function (data) {
    return {
      templateWrappers : undefined,
      template : 'agenda',
      agenda : data,
    };
  },
  getFileFields : function () {
    return { image : {
      tags: ['agendas'],
      width: 1000,
      height: 1000,
      crop: 'limit',
      eager: [
        cloudimage.preset.front,
        cloudimage.preset.thumb,
      ],
    }};
  },
  handleGet: function (req, res, next) {
    const id = req.params.id;
    Promise.all([
      this.doGet(this.getPath === true ? req.params.id : req.params),
      this.getFormData(),
      this.getAgendaRelationships(id),
      this.getSpeakerRelationships(id),
    ]).then(result => {
      const content = result[0];
      let formData = result[1];
      Object.assign(formData, content);

      formData.relatedAgendas = result[2].map((r) => {
        return r.agenda_from === id ? r.agenda_to : r.agenda_from;
      });

      formData.speaker = result[3].map((r) => {
        return r.speaker;
      });

      if (!content) {
        const error = new Error("Couldn't find the specified object");
        error.status = 404;
        throw error;
      } else {
        this.assembleAdminPage(req, res, next, {
          [this.formName]: this.getForm(formData),
        });
      }
    })
    .catch(next);
  },
  getFormSettings : function (data) {
    data = data || {};
    let form = {
      id: fields.number({ widget: forms.widgets.hidden() }),
      title: fields.string({ required: true, label: 'Titel', validators: [forms.validators.maxlength(255)] }),
      start: fields.string({ required: true, label: 'Startar', cssClasses: {field: ['time']}, validators: [validateTime()] }),
      stop: fields.string({ required: true, label: 'Slutar', cssClasses: {field: ['time']}, validators: [validateTime()] }),
      category: fields.string({ required: true, label: 'Spår', choices: ['Vänster', 'Höger'], widget: forms.widgets.multipleRadio() }),
      speaker: fields.string({ label: 'Talare' }),
      relatedAgendas: fields.array({
        label: 'Relaterade programpunkter',
        widget: widgets.multipleSelect(),
        choices: data.agendas || {},
      }),
      description: fields.string({ label: 'Beskrivning', widget: forms.widgets.textarea() }),
      image: fields.string({ label: 'Bild', widget: formsUtil.widgets.image() }),
      deleteImage : fields.boolean({ widget: forms.widgets.hidden() }),
      tags: fields.string({ label: 'Taggar', validators: [] }),
      published: fields.boolean({ label: 'Publicerad' }).bind(true),
    };

    const integrations = this.hasIntegrations();
    if (Array.isArray(integrations) && integrations.indexOf('speakers') !== -1) {
      form.speaker = fields.array({
        label: 'Talare',
        choices: data.speakers || {},
        widget: widgets.multipleSelect(),
      });
    }

    return form;
  },
  getList : function (only, excludeRelationships) {
    let query = this.knex('agenda')
      .select('id', 'title', 'start', 'stop', 'category', 'published', 'modified', 'data')
      .orderBy('start', 'asc')
      .orderBy('category', 'asc')
      .orderBy('title', 'asc');

    if (only) {
      query.whereIn('id', only);
    }

    return query.then((a) => {
      const promises = [ Promise.resolve(a) ];
      if (!excludeRelationships) {
        a.forEach((agenda) => { promises.push(this.getRelatedSpeakers(agenda.id)); });
        a.forEach((agenda) => { promises.push(this.getRelatedAgendas(agenda.id)); });
      }
      return Promise.all(promises);
    }).then(([ agenda, relatedSpeakers, relatedAgendas ]) => {
      return agenda.map((agenda) => {
        agenda.relatedSpeakers = Array.isArray(relatedSpeakers) ? relatedSpeakers : [];
        return agenda;
      });
    });
  },
  doGet : function (id) {
    const getSingle = this.knex('agenda').first(
      'id',
      'title',
      this.knex.raw("to_char(start, 'HH24:MI') AS start"),
      this.knex.raw("to_char(stop, 'HH24:MI') AS stop"),
      'description',
      this.knex.raw('category::text'),
      'speaker',
      'published',
      'data',
      'image'
    ).where('id', id)
    .then(item => item ? Object.assign(item, item.data || {}) : item);

    return Promise.all([
      getSingle,
      this.getRelatedAgendas(id),
      this.getRelatedSpeakers(id),
      Tags.getAgendaTags(id, this.knex),
    ]).then(([content, agendas, speakers, tags]) => {
      content.relatedAgendas = agendas;
      content.relatedSpeakers = speakers;
      content.tags = tags.join(', ');

      return content;
    });
  },
  doDelete : function (id) {
    return this._deleteImage(id).then(function () {
      return this.knex('agenda').where('id', id).delete();
    }.bind(this));
  },
  doPost : function (form) {
    var data = {
      title: form.data.title,
      start: form.data.start,
      stop: form.data.stop,
      description: form.data.description,
      category: form.data.category,
      published: form.data.published,
      data: form.data.data || null,
    };

    let tags = Tags.separate(form.data.tags);

    if (form.data.image) {
      data.image = form.data.image;
    }

    if (form.data.id) {
      // If we have a new image or the old image should be deleted, create a promise for the deletion.
      var removeOldImage = (form.data.deleteImage || data.image)
        ? this._deleteImage(form.data.id) : Promise.resolve();

      data.modified = this.knex.raw('NOW()');
      return Promise.all([
        removeOldImage,
        this.updateAgendaRelationships(form.data.id, form.data.relatedAgendas),
        this.updateSpeakerRelationships(form.data.id, form.data.speaker),
        this.knex('agenda')
          .where('id', form.data.id)
          // If the image is to be deleted that's what we'll do.
          .update(form.data.deleteImage ? { image: null, modified: data.modified } : data),
        Tags.updateAgendaTags(form.data.id, tags, this.knex),
      ]);
    } else {
      return this.knex('agenda')
        .returning(['id'])
        .insert(data)
        .then((insertIds) => {
          insertIds = (Array.isArray(insertIds) ? insertIds : []).map((itm) => itm.id);
          return Promise.all([
            Promise.all(insertIds.map((id) => this.updateAgendaRelationships(id, form.data.relatedAgendas))),
            Promise.all(insertIds.map((id) => this.updateSpeakerRelationships(id, form.data.speaker))),
            Promise.all(insertIds.map((id) => Tags.updateAgendaTags(id, tags, this.knex))),
          ]);
        });
    }
  },

  updateAgendaRelationships: function (id, related) {
    // Relationships are symmetrical and the from column is always < than the to column.
    // First get all of the existing relationships
    return this.getAgendaRelationships(id).then((relations) => {
      const current = related.map(to => ({ agenda_from: Math.min(id, to), agenda_to: Math.max(id, to) }));

      // New relationships are those that do not exist in `relations`
      const newRelationships = current.filter((r) => {
        return !relations.some((e) => {
          return r.agenda_from === e.agenda_from && r.agenda_to === e.agenda_to;
        });
      });

      // Deleted relationships are those that are in `relations` but not `current`
      const deletedRelationships = relations.filter((r) => {
        return !current.some((c) => {
          return r.agenda_from === c.agenda_from && r.agenda_to === c.agenda_to;
        });
      }).map((itm) => itm.id);

      return Promise.all([
        this.knex('agenda_agendas').insert(newRelationships),
        this.knex('agenda_agendas').del().whereIn('id', deletedRelationships),
      ]);
    });
  },

  updateSpeakerRelationships: function (agenda, related) {
    return this.getSpeakerRelationships(agenda)
      .then((speakers) => {
        const existing = speakers.map(({speaker}) => speaker);

        // New relationships are in `related` but not in `existing`.
        const newRelationships = related
          .filter((i) => !existing.some((e) => e === i))
          .map((speaker) => ({ speaker, agenda }));

        // Deleted relationships are in `existing` but not in `related`.
        const deletedRelationships = speakers
          .filter(e => !related.some((r) => e.speaker === r))
          .map(({id}) => id);

        return Promise.all([
          this.knex('speaker_agendas').del().whereIn('id', deletedRelationships),
          this.knex('speaker_agendas').insert(newRelationships),
        ]);
      });
  },

  getAgendaRelationships: function (id) {
    return Promise.all([
      this.knex('agenda_agendas')
        .where('agenda_from', id)
        .select(),
      this.knex('agenda_agendas')
        .where('agenda_to', id)
        .select(),
    ]).then((relationships) => {
      return relationships[0].concat(relationships[1]);
    });
  },

  getSpeakerRelationships: function (id) {
    return this.knex('speaker_agendas')
      .where('agenda', id)
      .select();
  },

  getRelatedAgendas: function (id) {
    return this.getAgendaRelationships(id)
      .then(related => {
        const ids = related.map(({agenda_from, agenda_to}) => {
          return agenda_from === id ? agenda_to : agenda_from;
        });
        return this.getList(ids, true);
      });
  },

  getRelatedSpeakers: function (id) {
    return this.getSpeakerRelationships(id)
      .then(related => {
        const ids = related.map(({speaker}) => speaker);
        return this.getSpeakers(ids);
      }).then((related) => {
        return related.reduce((previous, current) => {
          return previous.concat(current);
        }, []);
      });
  },

  getAdminRoutes: function () {
    let router = ContentType.prototype.getAdminRoutes.call(this);
    router.get('/agenda/:id/export', (req, res) => {
      const id = req.params.id;
      const agenda = 'agenda-' + id;

      const separator = ',';
      const columns = ['id', 'ticket', 'firstName', 'lastName', 'email', 'company', 'city', 'country', 'twitter', 'lat', 'long'];

      this.knex
        .from('ticket_order as order')
        .select('order.id', 'items.ticket', 'items.item_id')
        .where('order.ticket_type', agenda)
        .leftJoin('ticket_items as items', 'order.id', 'items.tid')
        .then((result) => {
          const rows = result.map((row) => {
            row.ticket.id = row.item_id;
            row.ticket.ticket = row.id;
            return row.ticket;
          }).map((row) => {
            return columns.map((key) => {
              return '"' + row[key] + '"';
            }).join(separator);
          });

          rows.unshift(columns.join(separator));
          rows.unshift('sep=;');

          res.setHeader('Content-disposition', 'attachment; filename=' + agenda + '.csv');
          res.setHeader('Content-type', 'text/csv');
          res.send(rows.join('\n'));
          res.end();
        })
        .catch((err) => {
          res.status(500);
          res.send('Internal server error.');
          res.send(err);
          res.end();
          console.log(err);
        });
    });

    return router;
  },

  _deleteImage: function (id) {
    return this.knex('agenda')
      .first('image')
      .where('id', id)
      .then(function (result) {
        if (result && result.image && result.image.indexOf('/') === -1) {
          cloudinary.uploader.destroy(result.image, function (result) {
            console.log('Image destruction:', result);
          });
        }
      });
  },
});
