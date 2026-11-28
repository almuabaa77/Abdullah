import { useState, type FormEvent } from 'react'
import type { CircleOption, Student } from './domain'
import { threePartName } from './enrollment'
import { circleTimeText, useWorkspace } from './ui'

type EnrollmentRole='teacher'|'student'|'parent'

export function EnrollmentName({three,value,label}:{three:boolean;value?:string;label?:string}) {
  const {t}=useWorkspace()
  const [error,setError]=useState(false)
  const validate=(input:HTMLInputElement)=>{
    const invalid=three&&input.value!==value&&!threePartName(input.value)
    input.setCustomValidity(invalid?t('أدخل ثلاث كلمات من الحروف فقط.','Enter exactly three words using letters only.'):'')
    setError(invalid)
  }
  return <label>{label??(three?t('الاسم الثلاثي','Three-part name'):t('الاسم الكامل','Full name'))}
    <input name="name" autoComplete="name" maxLength={90} defaultValue={value} required aria-invalid={error||undefined}
      onChange={event=>validate(event.currentTarget)} onBlur={event=>{if(event.currentTarget.value)validate(event.currentTarget)}}/>
    {three&&<small className={error?'error-text':'muted'}>{t('ثلاث كلمات بالحروف فقط، دون أرقام أو رموز.','Exactly three words, with letters only.')}</small>}
  </label>
}
export function CircleField({circles,value}:{circles:CircleOption[];value?:string}) {
  const {t}=useWorkspace()
  return <label>{t('الحلقة المسندة','Assigned circle')}<select name="circleId" defaultValue={value ?? ''} required>
    <option value="">{t('اختر الحلقة','Select a circle')}</option>
    {circles.map(circle=><option value={circle.id} key={circle.id}>{circle.name}{circleTimeText(circle,t)?' · '+circleTimeText(circle,t):''}</option>)}
  </select>{!circles.length&&<small className="muted">{t('لا توجد حلقات متاحة حاليًا.','There are no circles available currently.')}</small>}</label>
}
export function StudentFields({student,circles}:{student?:Student;circles:CircleOption[]}) {
  const {t}=useWorkspace()
  return <>
    <CircleField circles={circles} value={student?.circleId}/>
    <div className="field-pair">
      <label>{t('العمر بالسنوات','Age in years')}<input type="text" name="age" inputMode="numeric" pattern="[0-9٠-٩۰-۹]{1,3}" defaultValue={student?.age} required={!student||student.age!==undefined}/></label>
      <label>{t('المرحلة الدراسية','School stage')}<input name="schoolStage" maxLength={80} defaultValue={student?.schoolStage} required={!student||Boolean(student.schoolStage)}/></label>
    </div>
    <label>{t('رقم جوال ولي الأمر (اختياري)','Guardian mobile (optional)')}<input name="guardianPhone" type="tel" dir="ltr" defaultValue={student?.guardianPhone} placeholder="05X XXX XXXX"/></label>
    <label>{t('العنوان','Address')}<input name="address" autoComplete="street-address" maxLength={240} defaultValue={student?.address} required={!student||Boolean(student.address)}/></label>
  </>
}
export function ChildField({value,optional=false}:{value?:string;optional?:boolean}) {
  const {data,t}=useWorkspace()
  const circles=new Map(data.circles.map(circle=>[circle.id,circle.name]))
  return <label>{t('الابن','Child')}<select name="childId" defaultValue={value??''} required={!optional}>
    <option value="">{optional?t('ربط الابن لاحقًا','Link the child later'):t('اختر الابن','Select the child')}</option>
    {data.students.filter(student=>student.active).map(student=><option key={student.id} value={student.id}>{student.name} · {circles.get(student.circleId)}{student.phone?' · '+student.phone:''}</option>)}
  </select></label>
}
export function ChildIdentityFields({phoneField='childPhone'}:{phoneField?:string}) {
  const {t}=useWorkspace()
  return <>
    <label>{t('اسم الابن كما هو مسجّل','Child’s registered name')}<input name="childName" maxLength={90} required/></label>
    <label>{t('رقم جوال الابن','Child’s mobile number')}<input name={phoneField} type="tel" inputMode="tel" dir="ltr" required placeholder="05X XXX XXXX"/></label>
  </>
}
export function EnrollmentFields({source}:{source:'self'|'admin'}) {
  const {data,t}=useWorkspace()
  const [role,setRole]=useState<EnrollmentRole>('teacher')
  return <>
    <label>{t('نوع الحساب','Account type')}<select name="role" value={role} onChange={event=>setRole(event.target.value as EnrollmentRole)}>
      <option value="teacher">{t('محفّظ','Teacher')}</option><option value="student">{t('طالب','Student')}</option><option value="parent">{t('ولي أمر','Guardian')}</option>
    </select></label>
    <EnrollmentName key={role} three={role!=='teacher'}/>
    {source==='self'
      ? <label>{t('رقم الجوال الموثّق','Verified mobile number')}<input type="tel" dir="ltr" value={data.verifiedPhone??''} readOnly/></label>
      : <label>{t('رقم جوال الحساب','Account mobile number')}<input name="phone" type="tel" inputMode="tel" dir="ltr" required placeholder="05X XXX XXXX"/>
        <small className="muted">{t('يتحقق صاحب الحساب من رقمه عند أول دخول.','The account holder verifies this number on first sign-in.')}</small></label>}
    {role==='student'&&<StudentFields circles={source==='self'?data.enrollmentCircles??[]:data.circles}/>}
    {role==='parent'&&(source==='self'?<ChildIdentityFields/>:<ChildField/>)}
    {role==='teacher'&&<label>{t('العنوان','Address')}<input name="address" autoComplete="street-address" maxLength={240} required/></label>}
  </>
}

export function Registration({busy,submit,exit}:{busy:boolean;submit:(event:FormEvent<HTMLFormElement>)=>void;exit:()=>void}) {
  const {t}=useWorkspace()
  return <section className="panel section-panel intro-card signup-card">
    <div className="signup-verified">{t('تم التحقق من رقم الجوال','Phone number verified')}</div>
    <h1>{t('إكمال طلب التسجيل','Complete your registration')}</h1>
    <p>{t('اختر نوع الحساب وأكمل بياناته. تراجع الإدارة الطلب قبل التفعيل.','Choose your account type and complete its details. Administration reviews the request before activation.')}</p>
    <form className="form-stack" onSubmit={submit}><EnrollmentFields source="self"/>
      <button className="btn btn-primary" disabled={busy}>{t('إرسال طلب التسجيل','Submit registration')}</button>
    </form>
    <button className="text-button" type="button" onClick={exit}>{t('تسجيل الخروج','Sign out')}</button>
  </section>
}
