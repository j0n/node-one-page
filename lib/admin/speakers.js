'use strict';

var ContentType = require('../../').BaseType;
var _ = require('lodash');
var formsUtil = require('../utils/forms');
var forms = require('forms');
var fields = forms.fields;
var widgets = forms.widgets;
var cloudinary = require('cloudinary');
var cloudimage = require('../utils/cloudimage');

module.exports = ContentType.extend({
  constructor : function (options) {
    this.formName = 'speakerForm';

    options = _.extend({
      id : 'speakers',
    }, options || {});

    ContentType.call(this, options);

    this.isMultiPage = !!options.multipage;

    this.getPath = true;
    this.deletePath = true;
    this.formTemplate = 'admin-form-speakers';
    this.agendaProviders = [];
  },
  supportsMultiPage: function () {
    return this.isMultiPage;
  },
  hasIntegrations: function () {
    return ['agenda'];
  },
  addIntegration : function (contentType) {
    if (contentType.id === 'agenda') {
      contentType.addSpeakerProvider((fi) => this.getList(null, fi));
    }
  },
  handleGet: function (req, res, next) {
    const id = req.params.id;
    Promise.all([
      this.doGet(this.getPath === true ? req.params.id : req.params),
      this.getFormData(),
      this.getAgendaRelationships(id),
    ]).then(result => {
      const content = result[0];
      let formData = result[1];
      Object.assign(formData, content);

      formData.referencedAgenda = result[2].map((a) => {
        return a.agenda;
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
    }).catch(next);
  },
  getDataQuery : function (page) {
    let query = this.knex('speakers')
      .select('id', 'name', 'description', 'image', 'links', 'data')
      .where('published', true)
      .orderBy('name', 'asc');

    if (this.supportsMultiPage()) {
      query = query.where('page', page || 0);
    }

    return query.then(speakers =>
      speakers.map(speaker =>
        Object.assign(speaker, speaker.data, { data: undefined })
      )
    ).then((speakers) => {
      return Promise.all(speakers.map((speaker) => {
        return this.getRelatedAgendas(speaker.id).then((related) => {
          speaker.agendas = Array.isArray(related) ? related[0] : [];
          return speaker;
        })
      }));
    });
  },
  getTemplate : function (data, dictionary) {
    var subChildren = [];

    //TODO: Remake into a speaker element type which resolves these subChildren through an added preRenders function
    _.each(data, function (speaker) {
      subChildren.push({
        template : 'speaker',
        variables : { el : speaker },
      });
    });

    return {
      children : subChildren,
      variables : {
        menuName : dictionary.speakers,
        name : 'speakers',
        header : dictionary.speakersHeader,
      },
    };
  },
  getFileFields : function () {
    return { image : {
      tags: ['speakers'],
      width: 1000,
      height: 1000,
      crop: 'limit',
      eager: [
        cloudimage.preset.front,
        cloudimage.preset.thumb,
      ],
    }};
  },
  getFormSettings : function (data) {
    data = data || {};
    return {
      id: fields.number({ widget: forms.widgets.hidden() }),
      name: fields.string({ required: true, label: 'Namn', validators: [forms.validators.maxlength(255)] }),
      description: fields.string({
        label: 'Introduktion',
        widget: forms.widgets.textarea(),
        validators: [forms.validators.maxlength(255)],
      }),
      image: fields.string({ label: 'Bild', widget: formsUtil.widgets.image() }),
      //TODO: test if this works
      deleteimage : fields.boolean({ widget: forms.widgets.hidden() }),
      twitter: fields.string({ widget: forms.widgets.text() }),
      github: fields.string({ label: 'GitHub', widget: forms.widgets.text() }),
      linkedin: fields.string({ label: 'LinkedIn' }),
      dribbble: fields.string({ label: 'Dribbble' }),
      video: fields.string({ label: 'Video' }),
      blog: fields.string({ label: 'Blogg' }),
      published: fields.boolean({ label: 'Publicerad' }).bind(true),
      referencedAgenda: fields.array({
        label: 'Relaterade programpunkter',
        choices: data.agendas || {},
        widget: widgets.multipleSelect(),
      }),
    };
  },
  getAgendas: function (fullObjects, filtered) {
    const promises = this.agendaProviders.map(fn => {
      if (typeof fn.then === 'function') {
        return fn;
      } else {
        return new Promise((resolve, reject) => {
          resolve(fn(fullObjects, filtered));
        });
      }
    });

    return Promise.all(promises);
  },
  getFormData: function (currentPage) {
    return this.getAgendas(false)
      .then(agendas => {
        let formAgendas = {};
        let key;
        agendas.forEach((itm) => {
          for (key in itm) {
            if (!itm.hasOwnProperty(key)) { continue; }
            formAgendas[key] = itm[key];
          }
        });

        return {
          agendas: formAgendas
        };
      });
  },
  getList: function (currentPage, only) {
    let query = this.knex('speakers')
      .select('id', 'name', 'published', 'modified', 'data')
      .where('page', currentPage || 0)
      .orderBy('name', 'asc');

    if (only) {
      query.whereIn('id', only);
    }

    return query;
  },
  doGet: function (id) {
    return Promise.all([
      this.knex('speakers')
        .where('id', id)
        .first('id', 'name', 'description', 'links', 'image', 'published', 'data'),
      this.getRelatedAgendas(id)
    ]).then(function ([speaker, relatedAgendas]) {
      if (speaker && speaker.links) {
        _.each(speaker.links, function (link, type) {
          if (!speaker[type]) {
            speaker[type] = link;
          }
        });
        delete speaker.links;
      }
      if (speaker) {
        speaker = Object.assign(speaker, speaker.data || {});
      }
      speaker.relatedAgendas = relatedAgendas;
      return speaker;
    });
  },
  doDelete: function (id) {
    return this._deleteImage(id).then(function () {
      return this.knex('speakers').where('id', id).delete();
    }.bind(this));
  },
  deleteByPage: function (page) {
    return this.knex('speakers').where('page', page).delete();
  },
  doPost: function (form, req) {
    console.log("Do post", form, req);
    var data = {
      page: req.multipage ? req.multipage.id : 0,
      name: form.data.name,
      description: form.data.description,
      links: {
        twitter : form.data.twitter,
        github : form.data.github,
        linkedin : form.data.linkedin,
        dribbble : form.data.dribbble,
        video : form.data.video,
        blog : form.data.blog,
      },
      published: form.data.published,
      data: form.data.data || null,
    };

    if (form.data.image) {
      data.image = form.data.image;
    }

    if (form.data.id) {
      var removeOldImage = (form.data.deleteimage || data.image) ? this._deleteImage(form.data.id) : Promise.resolve();

      data.modified = this.knex.raw('NOW()');

      return Promise.all([
        removeOldImage,
        this.updateAgendaRelationships(form.data.id, form.data.referencedAgenda),
      ]).then(() =>
        this.knex('speakers')
          .where('id', form.data.id)
          .update(form.data.deleteimage ? { image: null, modified: data.modified } : data)
      );
    } else {
      return this.knex('speakers')
        .returning(['id'])
        .insert(data)
        .then((insertIds) => {
          insertIds = (Array.isArray(insertIds) ? insertIds : []).map((itm) => itm.id);
          return Promise.all(insertIds.map((id) => this.updateAgendaRelationships(id, form.data.referencedAgenda)));
        });
    }
  },
  addAgendaProvider: function (provider) {
    this.agendaProviders.push(provider);
  },
  _deleteImage: function (id) {
    return this.knex('speakers')
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

  updateAgendaRelationships: function (speaker, related) {
    return this.getAgendaRelationships(speaker)
      .then((agendas) => {
        // New relationships are in `related` but not in `agendas`
        const newRelationships = related
          .filter(s => !agendas.some(({speaker}) => speaker === s))
          .map((agenda) => ({ speaker, agenda }));

        // Deleted relationships are in `agendas` but not in `related`
        const deletedRelationships = agendas
          .filter(a => !related.some(({_speaker}) => speaker === _speaker))
          .map(({id}) => id);

        return Promise.all([
          this.knex('speaker_agendas').del().whereIn('id', deletedRelationships),
          this.knex('speaker_agendas').insert(newRelationships)
        ]);
      });
  },

  getAgendaRelationships: function (speaker) {
    return this.knex('speaker_agendas')
      .where('speaker', speaker)
      .select();
  },

  getRelatedAgendas: function (speaker) {
    return this.getAgendaRelationships(speaker)
      .then((agendas) => {
        let ids = agendas.map(({agenda}) => agenda);
        return this.getAgendas(true, ids);
      });
  }
});
