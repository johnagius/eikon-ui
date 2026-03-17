
import json, os, re, shutil, hashlib
from collections import defaultdict

SRC_JSON = "eikon_productmap_data_only_fresh.json"
OUT_DIR = "productmap_github_split"

def edge_key(src,tgt,rel,label=''):
    return hashlib.md5(f'{src}|{tgt}|{rel}|{label}'.encode()).hexdigest()[:16]

def main():
    with open(SRC_JSON, 'r', encoding='utf-8') as f:
        D = json.load(f)

    out = OUT_DIR
    if os.path.exists(out):
        shutil.rmtree(out)
    for sub in ['productmap-data/core','productmap-data/neighbours/product','productmap-data/neighbours/symptom','productmap-data/neighbours/usecase','productmap-data/neighbours/bundle']:
        os.makedirs(os.path.join(out, sub), exist_ok=True)

    products=D['Products']; attrs=D['Product_Attributes']; symptoms=D['Symptoms']; psm=D['Product_Symptom_Map']
    usecases=D['Use_Cases']; uci=D['Use_Case_Items']; bundles=D['Bundles']; bi=D['Bundle_Items']; rels=D['Relationships_V2']; guards=D['POS_Guardrails']

    # --- Data-quality fix: nicotine / smoking-cessation products were incorrectly
    # tagged with "travel sickness" and "motion sickness" symptoms because they
    # share the "OTHER NERVOUS SYSTEM DRUGS" therapeutic class with actual
    # anti-emetics.  Strip those spurious tags so the mind-map stays accurate.
    _smoking_pids = {a['Product_ID'] for a in attrs if (a.get('Main_Indication') or '').lower() == 'smoking cessation'}
    _bad_symptoms = {'travel sickness', 'motion sickness'}
    _bad_sids = {s['Symptom_ID'] for s in symptoms if s['Symptom_Name'].lower() in _bad_symptoms}
    for p in products:
        if p['Product_ID'] in _smoking_pids:
            tags = [t.strip() for t in (p.get('Symptom_Tags') or '').split(';')]
            p['Symptom_Tags'] = '; '.join(t for t in tags if t.lower() not in _bad_symptoms)
    for a in attrs:
        if a['Product_ID'] in _smoking_pids:
            parts = [t.strip() for t in (a.get('Secondary_Indications') or '').split('|')]
            a['Secondary_Indications'] = ' | '.join(t for t in parts if t.lower() not in _bad_symptoms and t)
    psm = [m for m in psm if not (m['Product_ID'] in _smoking_pids and m['Symptom_ID'] in _bad_sids)]
    D['Product_Symptom_Map'] = psm

    # Also fix UC009 (Travel sickness pack): remove nicotine products, they are not anti-emetics
    uci = [u for u in uci if not (u['UseCase_ID'] == 'UC009' and u['Product_ID'] in _smoking_pids)]
    D['Use_Case_Items'] = uci

    # Fix "review needed" products: assign correct indications based on ingredients/class.
    _review_fixes = {
        'ANTITHROMBOTIC AGENTS':            {'main':'heart health','sec':'','tags':'heart health'},
        'UROLOGICALS':                      None,  # handled per-ingredient below
        'EMOLLIENTS AND PROTECTIVES':       None,  # handled per-ingredient below
        'ANTIEMETICS AND ANTINAUSEANTS':    {'main':'motion sickness','sec':'travel sickness','tags':'motion sickness; travel sickness'},
        'PSYCHOLEPTICS':                    {'main':'sleep support','sec':'','tags':'sleep support'},
        'ANTIMYCOTICS FOR SYSTEMIC USE':    {'main':'vaginal infection support','sec':'thrush (topical)','tags':'vaginal infection support; thrush (topical)'},
        'OTOLOGICALS':                      {'main':'ear pain','sec':'','tags':'ear pain'},
        'ALL OTHER THERAPEUTIC PRODUCTS':   {'main':'thyroid protection','sec':'','tags':'thyroid support'},
        'TONICS':                           {'main':'fatigue','sec':'supplementation','tags':'fatigue; supplementation'},
        'ALL OTHER NON-THERAPEUTIC PRODUCTS':{'main':'wound cleansing','sec':'nasal irrigation','tags':'nasal irrigation; wound care'},
    }
    _ingredient_overrides = {
        'TADALAFIL':    {'main':'erectile dysfunction','sec':'','tags':'erectile dysfunction'},
        'SILDENAFIL':   {'main':'erectile dysfunction','sec':'','tags':'erectile dysfunction'},
        'TROLAMINE':    {'main':'skin irritation','sec':'skin repair','tags':'skin irritation; skin repair'},
        'DIMETICONE':   {'main':'bloating','sec':'','tags':'bloating'},
        'PERMETHRIN':   {'main':'scabies treatment','sec':'skin irritation','tags':'scabies; skin irritation'},
        'ACICLOVIR':    {'main':'cold sore','sec':'','tags':'cold sores'},
        'ULIPRISTAL':   {'main':'emergency contraception','sec':'','tags':'emergency contraception'},
        'LEVONORGESTREL':{'main':'emergency contraception','sec':'','tags':'emergency contraception'},
        'LANOLIN':      {'main':'skin irritation','sec':'eczema | dermatitis','tags':'skin irritation; eczema; dermatitis'},
        'ZINC OXIDE':   {'main':'skin irritation','sec':'healing | wound care','tags':'skin irritation; healing; wound care'},
        'CITRULLINE':   {'main':'fatigue','sec':'supplementation','tags':'fatigue; supplementation'},
        'PASSIFLORA':   {'main':'sleep support','sec':'','tags':'sleep support'},
        'ROWATINEX':    {'main':'urinary stones','sec':'','tags':'urinary health'},
    }
    _sym_name_to_id = {s['Symptom_Name'].lower(): s['Symptom_ID'] for s in symptoms}
    _review_sid = _sym_name_to_id.get('review needed')
    for p in products:
        if (p.get('Symptom_Tags') or '').lower().strip() == 'review needed':
            tc = p.get('Therapeutic_Class','')
            ingr = (p.get('Ingredient_Base') or p.get('Active_Ingredients','')).upper()
            fix = None
            for key, override in _ingredient_overrides.items():
                if key in ingr:
                    fix = override; break
            if not fix:
                fix = _review_fixes.get(tc)
            if fix:
                p['Symptom_Tags'] = fix['tags']
                a = next((x for x in attrs if x['Product_ID'] == p['Product_ID']), None)
                if a:
                    a['Main_Indication'] = fix['main']
                    a['Secondary_Indications'] = fix['sec']
                if _review_sid:
                    psm = [m for m in psm if not (m['Product_ID'] == p['Product_ID'] and m['Symptom_ID'] == _review_sid)]
    D['Product_Symptom_Map'] = psm
    # --- end data-quality fix

    prod_by={r['Product_ID']:r for r in products}
    attr_by={r['Product_ID']:r for r in attrs}
    sym_by={r['Symptom_ID']:r for r in symptoms}
    uc_by={r['UseCase_ID']:r for r in usecases}
    bundle_by={r['Bundle_ID']:r for r in bundles}

    psm_by_prod=defaultdict(list); psm_by_sym=defaultdict(list)
    for r in psm:
        psm_by_prod[r['Product_ID']].append(r)
        psm_by_sym[r['Symptom_ID']].append(r)

    uci_by_prod=defaultdict(list); uci_by_uc=defaultdict(list)
    for r in uci:
        uci_by_prod[r['Product_ID']].append(r)
        uci_by_uc[r['UseCase_ID']].append(r)

    bi_by_prod=defaultdict(list); bi_by_bundle=defaultdict(list)
    for r in bi:
        bi_by_prod[r['Product_ID']].append(r)
        bi_by_bundle[r['Bundle_ID']].append(r)

    rel_by_source=defaultdict(list); rel_by_target=defaultdict(list)
    for r in rels:
        rel_by_source[r['Source_Product_ID']].append(r)
        rel_by_target[r['Target_Product_ID']].append(r)

    guard_by_source=defaultdict(list); guard_by_target=defaultdict(list)
    for r in guards:
        guard_by_source[r['Source_Product_ID']].append(r)
        guard_by_target[r['Target_Product_ID']].append(r)

    def product_node(pid):
        p=prod_by[pid]; a=attr_by.get(pid,{})
        return {'id': f'product:{pid}','nodeType':'product','refId':pid,'label':p['Product_Name'],'subtext':a.get('Main_Indication') or p.get('Therapeutic_Class') or '','meta':{'brand':a.get('Brand_Name'),'generic':a.get('Generic_Name'),'form':a.get('Dosage_Form') or p.get('Pharmaceutical_Form'),'formGroup':a.get('Form_Group') or p.get('Form_Family'),'route':a.get('Route_Group'),'mainIndication':a.get('Main_Indication'),'secondaryIndications':a.get('Secondary_Indications'),'otcCategory':a.get('OTC_Category') or p.get('Therapeutic_Class'),'seasonalGroup':a.get('Seasonal_Group'),'sedating':a.get('Sedating_Flag'),'nonDrowsy':a.get('Non_Drowsy_Flag'),'sugarFree':a.get('Sugar_Free_Flag'),'alcoholFree':a.get('Alcohol_Free_Flag'),'ingredientCount':a.get('Ingredient_Count'),'strengthText':a.get('Strength_Text'),'packSizeText':a.get('Pack_Size_Text'),'atcCode':p.get('ATC_Code'),'status':p.get('Status'),'supplierCatalogKey':p.get('Supplier_Catalog_Key')}} 
    def symptom_node(sid):
        s=sym_by[sid]
        return {'id': f'symptom:{sid}','nodeType':'symptom','refId':sid,'label':s['Symptom_Name'],'subtext':s.get('Symptom_Category') or '','meta':s}
    def usecase_node(uid):
        u=uc_by[uid]
        return {'id': f'usecase:{uid}','nodeType':'usecase','refId':uid,'label':u['UseCase_Name'],'subtext':u.get('UseCase_Category') or '','meta':u}
    def bundle_node(bid):
        b=bundle_by[bid]
        return {'id': f'bundle:{bid}','nodeType':'bundle','refId':bid,'label':b['Bundle_Name'],'subtext':b.get('Bundle_Type') or '','meta':b}

    def add_node(nodes, nd):
        nodes[nd['id']] = nd
    def link_obj(src,tgt,rel,label='',score=None,why=None,meta=None):
        return {'key': edge_key(src,tgt,rel,label),'source':src,'target':tgt,'rel':rel,'label':label or '','score':score,'why':why or '','meta':meta or {}}
    def write_json(relpath, obj):
        with open(os.path.join(out, relpath), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',',':'))

    manifest = {'version':'2026-03-17-gh-split-v1','generated_from':SRC_JSON,'counts':{'products':len(products),'symptoms':len(symptoms),'useCases':len(usecases),'bundles':len(bundles),'relationships':len(rels),'guardrails':len(guards),'productSymptomMaps':len(psm),'useCaseItems':len(uci),'bundleItems':len(bi)}}
    write_json('productmap-data/manifest.json', manifest)

    search_index=[]
    for p in products:
        a=attr_by.get(p['Product_ID'],{})
        terms=[p['Product_Name'], p.get('Brand_Family'), p.get('Active_Ingredients'), p.get('Ingredient_Base'), p.get('Therapeutic_Class'), p.get('Symptom_Tags'), a.get('Brand_Name'), a.get('Generic_Name'), a.get('Main_Indication'), a.get('Secondary_Indications'), a.get('OTC_Category'), a.get('Seasonal_Group')]
        search_index.append({'id':f'product:{p["Product_ID"]}','nodeType':'product','refId':p['Product_ID'],'label':p['Product_Name'],'searchText':' | '.join([str(t) for t in terms if t]),'priority':int((p.get('Total_Links') or 0)+(p.get('Complement_Links') or 0))})
    for s in symptoms:
        aliases=[]
        name=s['Symptom_Name'].lower()
        if 'diarrhoea' in name: aliases += ['diarrhea']
        if 'haemorrhoid' in name: aliases += ['hemorrhoid']
        terms=[s['Symptom_Name'], s.get('Symptom_Category'), s.get('Display_Group')] + aliases
        search_index.append({'id':f'symptom:{s["Symptom_ID"]}','nodeType':'symptom','refId':s['Symptom_ID'],'label':s['Symptom_Name'],'searchText':' | '.join([str(t) for t in terms if t]),'priority':int((s.get('Priority_For_Graph') or 0)+(s.get('Linked_Product_Count') or 0))})
    for u in usecases:
        terms=[u['UseCase_Name'], u.get('UseCase_Category'), u.get('Trigger_Symptoms'), u.get('Description')]
        search_index.append({'id':f'usecase:{u["UseCase_ID"]}','nodeType':'usecase','refId':u['UseCase_ID'],'label':u['UseCase_Name'],'searchText':' | '.join([str(t) for t in terms if t]),'priority':120})
    for b in bundles:
        terms=[b['Bundle_Name'], b.get('Bundle_Type'), b.get('Description')]
        search_index.append({'id':f'bundle:{b["Bundle_ID"]}','nodeType':'bundle','refId':b['Bundle_ID'],'label':b['Bundle_Name'],'searchText':' | '.join([str(t) for t in terms if t]),'priority':100})
    write_json('productmap-data/search-index.json', search_index)

    for nm,key in [('products','Products'),('product_attributes','Product_Attributes'),('symptoms','Symptoms'),('product_symptom_map','Product_Symptom_Map'),('usecases','Use_Cases'),('usecase_items','Use_Case_Items'),('bundles','Bundles'),('bundle_items','Bundle_Items'),('relationships_v2','Relationships_V2'),('pos_guardrails','POS_Guardrails')]:
        write_json(f'productmap-data/core/{nm}.json', D[key])

    for pid in prod_by:
        nodes={}; center=product_node(pid); add_node(nodes, center); links=[]
        seen=set()
        for r in rel_by_source[pid] + rel_by_target[pid]:
            if r['Edge_ID'] in seen: continue
            seen.add(r['Edge_ID'])
            other = r['Target_Product_ID'] if r['Source_Product_ID']==pid else r['Source_Product_ID']
            add_node(nodes, product_node(other))
            rel='similar' if str(r['Relationship_Type']).lower()=='similar' else 'complement'
            links.append(link_obj(f'product:{r["Source_Product_ID"]}',f'product:{r["Target_Product_ID"]}',rel,r.get('Line_Label') or '',r.get('Overall_Score'),r.get('Why_Linked'),{'edgeId':r['Edge_ID']}))
        for r in psm_by_prod[pid]:
            add_node(nodes, symptom_node(r['Symptom_ID']))
            links.append(link_obj(center['id'], f'symptom:{r["Symptom_ID"]}','symptom',r.get('Role_In_Symptom') or 'Symptom',r.get('Relevance_Score'),r.get('Map_Source'),{'mapId':r['Map_ID']}))
        for r in uci_by_prod[pid]:
            add_node(nodes, usecase_node(r['UseCase_ID']))
            links.append(link_obj(center['id'], f'usecase:{r["UseCase_ID"]}','usecase',r.get('Role_In_UseCase') or 'Use case',r.get('UseCase_Relevance_Score'),r.get('Trigger_Match'),{'useCaseItemId':r['UseCase_Item_ID']}))
        for r in bi_by_prod[pid]:
            add_node(nodes, bundle_node(r['Bundle_ID']))
            links.append(link_obj(center['id'], f'bundle:{r["Bundle_ID"]}','bundle',r.get('Role_In_Bundle') or 'Bundle',r.get('Bundle_Priority'),r.get('Why_In_Bundle'),{'bundleItemId':r['Bundle_Item_ID']}))
        seen=set()
        for r in guard_by_source[pid] + guard_by_target[pid]:
            if r['Edge_ID'] in seen: continue
            seen.add(r['Edge_ID'])
            other = r['Target_Product_ID'] if r['Source_Product_ID']==pid else r['Source_Product_ID']
            add_node(nodes, product_node(other))
            links.append(link_obj(f'product:{r["Source_Product_ID"]}',f'product:{r["Target_Product_ID"]}','guardrail',r.get('Guardrail_Type') or 'Guardrail',r.get('Score'),r.get('Why'),{'edgeId':r['Edge_ID'],'posAction':r.get('POS_Action')}))
        write_json(f'productmap-data/neighbours/product/{pid}.json', {'centerId':center['id'],'centerType':'product','refId':pid,'nodes':list(nodes.values()),'links':links})

if __name__ == "__main__":
    main()
