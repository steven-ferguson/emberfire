import Ember from 'ember';
import DS from 'ember-data';
// import firebase from 'firebase';

const { assign, get, isNone } = Ember;

/**
 * The Firebase serializer helps normalize relationships and can be extended on
 * a per model basis.
 */
export default DS.JSONSerializer.extend({
  extractId(modelClass, firebaseSnapshot) {
    return firebaseSnapshot.key;
  },

  extractAttributes(modelClass, firebaseSnapshot) {
    const attributes = {};
    modelClass.eachAttribute(key => {
      const attributeKey = this.keyForAttribute(key, 'deserialze');
      const childSnapshot = firebaseSnapshot.child(attributeKey);
      if (childSnapshot.exists()) {
        attributes[key] = childSnapshot.val();
      }
    });

    return attributes;
  },

  extractRelationships(modelClass, firebaseSnapshot) {
    const relationships = {};

    modelClass.eachRelationship((key, relationshipMeta) => {
      let relationship = null;
      const relationshipKey = this.keyForRelationship(key, relationshipMeta.kind, 'deserialze');
      const relationshipSnapshot = firebaseSnapshot.child(relationshipKey);

      if (relationshipSnapshot.exists()) {
        let data = null;
        if (relationshipMeta.kind === 'belongsTo') {
          if (relationshipMeta.options.polymorphic) {
            console.log('NEED TO IMPLEMENT');
          } else {
            data = this.extractRelationship(relationshipMeta.type, relationshipSnapshot);
          }
        } else if (relationshipMeta.kind === 'hasMany') {
          data = [];
          relationshipSnapshot.forEach(childSnapshot => {
            data.push(this.extractRelationship(relationshipMeta.type, childSnapshot));
          });
        }

        relationship = { data };
      }

      if (relationship) {
        relationships[key] = relationship;
      }
    });

    return relationships;
  },

  extractRelationship(relationshipModelName, firebaseSnapshot) {
    if (!firebaseSnapshot.exists()) { return null; }

    if (firebaseSnapshot.hasChildren()) {
      console.log('NEED TO IMPLEMENT');
    } else {
      const id = firebaseSnapshot.val() === true ? firebaseSnapshot.key : firebaseSnapshot.val();
      return { id, type: relationshipModelName };
    }
  },

  normalizeArrayResponse(store, primaryModelClass, firebaseSnapshot) {
    const documentHash = {
      data: null,
      included: []
    };

    const results = [];
    firebaseSnapshot.forEach(childSnapshot => {
      let { data, included } = this.normalize(primaryModelClass, childSnapshot);
      if (included) {
        documentHash.included.push(...included);
      }
      results.push(data);
    });

    documentHash.data = results;

    return documentHash;
  },

  serialize(snapshot, options) {
    const json = {};
    const { path } = options;

    snapshot.eachAttribute((key, attribute) => {
      this.serializeAttribute(snapshot, json, key, attribute, path);
    });

    snapshot.eachRelationship((key, relationship) => {
      const relationshipType = snapshot.type.determineRelationshipType(relationship, this.store);
      switch (relationshipType) {
        case 'oneToMany':
          this.serializeOneToMany(snapshot, json, relationship, path);
          break;
      }

      // if (relationship.kind === 'belongsTo') {
      //   this.serializeBelongsTo(snapshot, json, relationship, path);
      // } else if (relationship.kind === 'hasMany') {
      //   this.serializeHasMany(snapshot, json, relationship, path);
      // }
    });

    return json;
  },

  serializeAttribute(snapshot, json, key, attribute, path) {
    if (this._canSerialize(key)) {
      const type = attribute.type;
      let value = snapshot.attr(key);
      if (type) {
        const transform = this.transformFor(type);
        value = transform.serialize(value, attribute.options);
      }

      // if provided, use the mapping provided by `attrs` in
      // the serializer
      let payloadKey = this._getMappedKey(key, snapshot.type);
      if (payloadKey === key && this.keyForAttribute) {
        payloadKey = this.keyForAttribute(key, 'serialize');
      }

      json[`${path}/${payloadKey}`] = value;
    }
  },

  serializeOneToMany(snapshot, json, relationship, path) {
    this.serializeBelongsTo(snapshot, json, relationship, path);
    const inverseSerializer = this.store.serializerFor(relationship.type);
    const inverseSnapshot = snapshot.belongsTo(relationship.key);
    debugger;
    const { name } = snapshot.record.inverseFor(relationship.key);
    const inverseRelationship = inverseSnapshot.record.relationshipFor(name);

    if (snapshot.record.didChange(relationship.key) && snapshot.record.savedTrackerValue(relationship.key)) {
      inverseSerializer.serializeHasManyMember(
        relationship.type,
        snapshot.record.savedTrackerValue(relationship.key),
        json,
        inverseRelationship,
        snapshot,
        null
      );
    }

    inverseSerializer.serializeHasManyMember(
      relationship.type,
      inverseSnapshot.id,
      json,
      inverseRelationship,
      snapshot,
      true
    );
  },

  serializeHasManyMember(modelName, id, json, relationship, inverseSnapshot, value) {
    const key = relationship.key;
    if (this._canSerialize(key)) {
      const adapter = this.store.adapterFor(modelName);
      const path = adapter.buildPath(modelName, id);

      let payloadKey = this._getMappedKey(key, this.store.modelFor(modelName));
      if (payloadKey === key && this.keyForRelationship) {
        payloadKey = this.keyForRelationship(key, "hasMany", "serialize");
      }

      json[`${path}/${payloadKey}/${inverseSnapshot.id}`] = value;
    }
  },

  serializeBelongsTo(snapshot, json, relationship, path) {
    const key = relationship.key;

    if (this._canSerialize(key)) {
      const belongsToId = snapshot.belongsTo(key, { id: true });
      // if provided, use the mapping provided by `attrs` in
      // the serializer
      let payloadKey = this._getMappedKey(key, snapshot.type);
      if (payloadKey === key && this.keyForRelationship) {
        payloadKey = this.keyForRelationship(key, "belongsTo", "serialize");
      }

      if (isNone(belongsToId)) {
        json[`${path}/${payloadKey}`] = null;
      } else {
        json[`${path}/${payloadKey}`] = belongsToId;
      }

      if (relationship.options.polymorphic) {
        console.log('NEED TO IMPLEMENT');
        this.serializePolymorphicType(snapshot, json, relationship);
      }
    }
  },

  serializeHasMany(snapshot, json, relationship, path) {
    const key = relationship.key;
    if (this.shouldSerializeHasMany(snapshot, key, relationship)) {
      const hasMany = snapshot.hasMany(key, { ids: true });
      if (hasMany !== undefined) {
        // if provided, use the mapping provided by `attrs` in
        // the serializer
        let payloadKey = this._getMappedKey(key, snapshot.type);
        if (payloadKey === key && this.keyForRelationship) {
          payloadKey = this.keyForRelationship(key, "hasMany", "serialize");
        }

        json[`${path}/${payloadKey}`] = hasMany;
      }
    }
  },

  _canSerialize(key) {
   const attrs = get(this, 'attrs');

   return !attrs || !attrs[key] || attrs[key].serialize !== false;
 },

  _getMappedKey(key, modelClass) {
    let attrs = get(this, 'attrs');
    let mappedKey;
    if (attrs && attrs[key]) {
      mappedKey = attrs[key];
      //We need to account for both the { title: 'post_title' } and
      //{ title: { key: 'post_title' }} forms
      if (mappedKey.key) {
        mappedKey = mappedKey.key;
      }
      if (typeof mappedKey === 'string') {
        key = mappedKey;
      }
    }

    return key;
  },
});
// export default DS.JSONSerializer.extend(DS.EmbeddedRecordsMixin, {
//   isNewSerializerAPI: true,
//
//   /**
//    * Firebase have a special value for a date 'firebase.database.ServerValue.TIMESTAMP'
//    * that tells it to insert server time. We need to make sure the value is not scrapped
//    * by the data attribute transforms.
//    *
//    * @override
//    */
//   serializeAttribute(snapshot, json, key, attribute) {
//     var value = snapshot.attr(key);
//     this._super(snapshot, json, key, attribute);
//     if (this._canSerialize(key)) {
//       if (value === firebase.database.ServerValue.TIMESTAMP) {
//
//         var payloadKey = this._getMappedKey(key, snapshot.type);
//
//         if (payloadKey === key && this.keyForAttribute) {
//           payloadKey = this.keyForAttribute(key, 'serialize');
//         }
//         // do not transform
//         json[payloadKey] = value;
//       }
//     }
//   },
//
//
//   /**
//    * Firebase does not send null values, it omits the key altogether. This nullifies omitted
//    * properties so that property deletions sync correctly.
//    *
//    * @override
//    */
//   extractAttributes(modelClass, resourceHash) {
//     var attributes = this._super(modelClass, resourceHash);
//
//     // nullify omitted attributes
//     modelClass.eachAttribute((key) => {
//       if (!attributes.hasOwnProperty(key)) {
//         attributes[key] = null;
//       }
//     });
//
//     return attributes;
//   },
//
//
//   /**
//    * @override
//    */
//   extractRelationships(modelClass, payload) {
//     this.normalizeRelationships(modelClass, payload);
//     return this._super(modelClass, payload);
//   },
//
//
//   /**
//    * Normalizes `hasMany` relationship structure before passing
//    * to `JSONSerializer.extractRelationships`
//    *
//    * before:
//    *
//    * ```js
//    * {
//    *   comments: {
//    *     abc: true,
//    *     def: true,
//    *   }
//    * }
//    * ```
//    *
//    * after:
//    *
//    * ```js
//    * {
//    *   comments: [ 'abc', 'def' ]
//    * }
//    * ```
//    *
//    * Or for embedded objects:
//    *
//    * ```js
//    * {
//    *   comments: {
//    *     'abc': { body: 'a' },
//    *     'def': { body: 'd' )
//    *   }
//    * }
//    * ```
//    *
//    * these should become:
//    *
//    * ```js
//    * {
//    *   comments: [
//    *     {
//    *       id: 'abc',
//    *       body: 'a'
//    *     },
//    *     {
//    *       id: 'def',
//    *       body: 'd'
//    *     }
//    *   ]
//    * }
//    * ```
//    */
//   normalizeRelationships(modelClass, payload) {
//     modelClass.eachRelationship((key, meta) => {
//       let relationshipKey = this.keyForRelationship(key, meta.kind, 'deserialize');
//
//       if (meta.kind === 'hasMany') {
//         if (payload.hasOwnProperty(relationshipKey)) {
//           let relationshipPayload = payload[relationshipKey];
//           // embedded
//           if (this.hasDeserializeRecordsOption(key)) {
//             if (typeof relationshipPayload === 'object' && !Ember.isArray(relationshipPayload)) {
//               relationshipPayload = Object.keys(relationshipPayload).map((id) => {
//                 return assign({ id: id }, relationshipPayload[id]);
//               });
//             } else if (Ember.isArray(relationshipPayload)) {
//               relationshipPayload = this._addNumericIdsToEmbeddedArray(relationshipPayload);
//             } else {
//               throw new Error(`${modelClass.toString()} relationship ${meta.kind}('${meta.type}') must contain embedded records with an \`id\`. Example: { "${key}": { "${meta.type}_1": { "id": "${meta.type}_1" } } } instead got: ${JSON.stringify(payload[key])}`);
//             }
//           }
//
//           // normalized
//           else {
//             if (typeof relationshipPayload === 'object' && !Ember.isArray(relationshipPayload)) {
//               relationshipPayload = Object.keys(relationshipPayload);
//             } else if (Ember.isArray(relationshipPayload)) {
//               relationshipPayload = this._convertBooleanArrayToIds(relationshipPayload);
//             } else {
//               throw new Error(`${modelClass.toString()} relationship ${meta.kind}('${meta.type}') must be a key/value map. Example: { "${key}": { "${meta.type}_1": true } } instead got: ${JSON.stringify(payload[key])}`);
//             }
//           }
//
//           payload[relationshipKey] = relationshipPayload;
//         }
//
//         // hasMany property is not present
//         // server will not send a property which has no content
//         // (i.e. it will never send `comments: null`) so we need to
//         // force the empty relationship
//         else {
//           payload[relationshipKey] = [];
//         }
//       }
//
//       if (meta.kind === 'belongsTo') {
//         if (!payload.hasOwnProperty(relationshipKey)) {
//           // server wont send property if it was made null elsewhere
//           payload[relationshipKey] = null;
//         }
//       }
//     });
//   },
//
//
//   /**
//    * Coerce arrays back into relationship arrays. When numeric ids are used
//    * the firebase server will send back arrays instead of object hashes in
//    * certain situations.
//    *
//    * See the conditions and reasoning here:
//    * https://www.firebase.com/docs/web/guide/understanding-data.html#section-arrays-in-firebase
//    *
//    * Stored in Firebase:
//    *
//    * ```json
//    * {
//    *   "0": true,
//    *   "1": true,
//    *   "3": true
//    * }
//    * ```
//    *
//    * Given back by the JS client:
//    *
//    * ```js
//    * [true, true, null, true]
//    * ```
//    *
//    * What we need:
//    *
//    * ```js
//    * [ "0", "1", "3" ]
//    * ```
//    *
//    * @param {Array} arr   Input array
//    * @return {Array}      Fixed array
//    * @private
//    */
//   _convertBooleanArrayToIds(arr) {
//     var result = [];
//     for (var i = 0; i <  arr.length; i++) {
//       if (arr[i] === true) {
//         result.push('' + i);
//       }
//       else if (typeof arr[i] === 'string') {
//         throw new Error(`hasMany relationship contains invalid data, should be in the form: { comment_1: true, comment_2: true } but was ${JSON.stringify(arr)}`);
//       }
//     }
//     return result;
//   },
//
//
//   /**
//    * Fix embedded array ids.
//    *
//    * Objects are stored in Firebase with their id in the key only:
//    *
//    * ```json
//    * {
//    *   "0": { obj0 },
//    *   "1": { obj1 },
//    *   "3": { obj3 }
//    * }
//    * ```
//    *
//    * Given back by the JS client:
//    *
//    * ```js
//    * [{ obj0 }, { obj1 }, null, { obj3 }]
//    * ```
//    *
//    * What we need:
//    *
//    * ```js
//    * [ { id: '0', ...obj0 }, { id: '1', ...obj1 }, { id: '3', ...obj3 } ]
//    * ```
//    *
//    * https://www.firebase.com/docs/web/guide/understanding-data.html#section-arrays-in-firebase
//    *
//    * @param {Array} arr   Input array
//    * @return {Array}      Fixed array
//    * @private
//    */
//   _addNumericIdsToEmbeddedArray(arr) {
//     var result = [];
//     for (var i = 0; i <  arr.length; i++) {
//       if (arr[i]) {
//         if (typeof arr[i] !== 'object') {
//           throw new Error(`expecting embedded object hash but found ${JSON.stringify(arr[i])}`);
//         }
//         result.push(assign({ id: '' + i }, arr[i]));
//       }
//     }
//     return result;
//   },
//
//
//   /**
//    * Even when records are embedded, bypass EmbeddedRecordsMixin
//    * and invoke JSONSerializer's method which serializes to ids only.
//    *
//    * The adapter handles saving the embedded records via `r.save()`
//    * and ensures that dirty states and rollback work.
//    *
//    * Will not be neccesary when this issue is resolved:
//    *
//    * https://github.com/emberjs/data/issues/2487
//    *
//    * @override
//    */
//   serializeHasMany(snapshot, json, relationship) {
//     DS.JSONSerializer.prototype.serializeHasMany.call(this, snapshot, json, relationship);
//   },
//
//
//   /**
//    * @see #serializeHasMany
//    * @override
//    */
//   serializeBelongsTo(snapshot, json, relationship) {
//     DS.JSONSerializer.prototype.serializeBelongsTo.call(this, snapshot, json, relationship);
//   },
//
//
//   /**
//    * @override
//    */
//   shouldSerializeHasMany(snapshot, key, relationship) {
//     return this._canSerialize(key);
//   },
//
//   /**
//    * @override
//    * @deprecated
//    */
//   _shouldSerializeHasMany(snapshot, key, relationship) {
//     return this._canSerialize(key);
//   }
// });
