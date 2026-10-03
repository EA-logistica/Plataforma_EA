from datetime import date
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert
from radar.normalize import normalize_ma
from radar.etl import load
from radar.models import Operation, Revision, Alert

def row(raw,artifact): return {**normalize_ma(raw),'artifact_id':artifact['id']}

def test_idempotent_and_revision(db,raw,artifact):
    r=row(raw,artifact)
    assert load(db,[artifact],[r])['inserted']==1
    assert load(db,[artifact],[r])['unchanged']==1
    changed=row({**raw,'FOB_DOLPOL':'28000','FMOD':'20260902'},artifact)
    assert load(db,[artifact],[changed])['updated']==1
    assert db.scalar(select(func.count()).select_from(Operation))==1
    assert db.scalar(select(func.count()).select_from(Revision))==2
    assert load(db,[artifact],[r])['older_ignored']==1

def test_web_does_not_replace_bulk(db,raw,artifact):
    r=row(raw,artifact);load(db,[artifact],[r])
    web=row({**raw,'DNOMBRE':''},artifact);web['source_priority']=10
    assert load(db,[artifact],[web])['older_ignored']==1
    assert db.scalar(select(Operation)).importer=='EMPRESA PLASTICA SAC'

def test_web_name_enrichment_by_exact_ruc(db,raw,artifact):
    load(db,[artifact],[row(raw,artifact)])
    web=row({**raw,'NUME_CORRE':'123457','DNOMBRE':''},artifact);web['source_priority']=10
    load(db,[artifact],[web])
    op=db.scalar(select(Operation).where(Operation.declaration=='123457'))
    assert op.importer=='EMPRESA PLASTICA SAC'
    assert op.raw['ma']['DNOMBRE']==''
    assert op.raw['_enrichment']['exact_ruc']=='20100367395'

def test_locked_classification_survives(db,raw,artifact):
    r=row(raw,artifact);load(db,[artifact],[r]);op=db.scalar(select(Operation));op.material='Otros';op.classification_locked=True;db.commit()
    load(db,[artifact],[row({**raw,'FOB_DOLPOL':'28000'},artifact)])
    assert db.scalar(select(Operation)).material=='Otros'

def test_alert_baseline_and_dedup(db,raw,artifact):
    load(db,[artifact],[row(raw,artifact)],baseline=None)
    assert db.scalar(select(func.count()).select_from(Alert))==0
    updated=row({**raw,'NUME_CORRE':'123457','FECH_INGSI':'20260910','PESO_NETO':'10000','FOB_DOLPOL':'30000'},artifact)
    load(db,[artifact],[updated],baseline=date(2026,9,1))
    count=db.scalar(select(func.count()).select_from(Alert));assert count==3
    load(db,[artifact],[updated],baseline=date(2026,9,1))
    assert db.scalar(select(func.count()).select_from(Alert))==count


# La API (búsqueda, perfiles, exportación) vive ahora en la plataforma:
# backend/radar/consultas.js, probada en tests/api.mjs.
